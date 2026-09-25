// Hugging Face Inference Providers adapter: free monthly credits, used for testing before switching to Claude.
import { extractText, getDocumentProxy } from "unpdf";
import { config } from "../config";
import { logger } from "../log";
import type { Part, StructuredRequest } from "./types";

const ROUTER = "https://router.huggingface.co";
const log = logger("hf");

type ContentItem = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function toContent(p: Part): Promise<ContentItem> {
  switch (p.kind) {
    case "text":
      return { type: "text", text: p.text };
    case "pdf": {
      // Open models can't read PDFs directly, so send the extracted text.
      const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(p.base64, "base64")));
      const { text } = await extractText(pdf, { mergePages: true });
      if (!text.trim()) throw new Error("Resume PDF has no readable text (scanned image?)");
      return { type: "text", text: `<document title="${p.title}">\n${text}\n</document>` };
    }
    case "document":
      return { type: "text", text: `<document title="${p.title}">\n${p.text}\n</document>` };
    case "image":
      return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${p.base64}` } };
  }
}

/** Waits before each retry; network drops and busy/cold-starting models usually clear within seconds. */
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const REQUEST_TIMEOUT_MS = 180_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** "fetch failed" hides the real reason (reset, DNS, timeout) in `cause`; surface it. */
function networkReason(err: unknown) {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError") return `no response within ${REQUEST_TIMEOUT_MS / 1000}s`;
  return [e?.message, e?.cause?.code ?? e?.cause?.message].filter(Boolean).join(": ");
}

async function hfFetch(url: string, init: RequestInit): Promise<Response> {
  const name = url.split("/").slice(-2).join("/");
  for (let attempt = 0; ; attempt++) {
    const retry = attempt < RETRY_DELAYS_MS.length;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${config.hfToken}`, ...init.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = networkReason(err);
      if (!retry) throw new Error(`Could not reach Hugging Face after ${attempt + 1} tries (${reason})`);
      log.warn(`${name}: network error (${reason}); retry ${attempt + 1} in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    if (res.ok) return res;
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    if (res.status === 402) throw new Error(`Hugging Face free credits used up for this month (402): ${detail}`);
    if (retry && RETRYABLE_STATUS.has(res.status)) {
      log.warn(`${name}: HTTP ${res.status}; retry ${attempt + 1} in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    throw new Error(`Hugging Face request failed (${res.status}): ${detail}`);
  }
}

/** Pulls the JSON object out of a reply that may be wrapped in ``` fences or extra text. */
function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Hugging Face model did not return JSON");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/**
 * Providers cap images per request (often 5). Keeps at most `max` images, spread evenly across the interview,
 * and replaces the rest with a short note so the model knows they were left out.
 */
function limitImages(parts: Part[], max: number): Part[] {
  const imageAt = parts.flatMap((p, i) => (p.kind === "image" ? [i] : []));
  if (imageAt.length <= max) return parts;
  log.info(`Sending ${Math.max(0, max)} of ${imageAt.length} webcam snapshots (HF_MAX_IMAGES=${max})`);
  const keep = new Set(
    max <= 0 ? [] : Array.from({ length: max }, (_, k) => imageAt[Math.round((k * (imageAt.length - 1)) / Math.max(1, max - 1))]),
  );
  return parts.map((p, i) =>
    p.kind === "image" && !keep.has(i) ? { kind: "text", text: "(snapshot not included, to fit the model's image limit)" } : p,
  );
}

/** One structured-output request to a Hugging Face chat model. Returns the parsed JSON matching `schema`. */
export async function hfStructured<T>(req: StructuredRequest): Promise<T> {
  const content = await Promise.all(limitImages(req.parts, config.hfMaxImages).map(toContent));
  content.push({
    type: "text",
    text: `Reply with only a JSON object matching this JSON Schema, no other text:\n${JSON.stringify(req.schema)}`,
  });
  const body = {
    model: config.hfModel,
    max_tokens: 8000,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content },
    ],
  };
  const post = (extra: object) =>
    hfFetch(`${ROUTER}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });

  // Not every provider supports schema-constrained output; retry without it (the prompt still asks for JSON).
  const res = await post({
    response_format: { type: "json_schema", json_schema: { name: "result", schema: req.schema } },
  }).catch((err: Error) => {
    if (/\((400|422)\)/.test(err.message)) {
      log.warn("Structured output rejected; retrying with plain JSON instructions:", err);
      return post({});
    }
    throw err;
  });
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (data.usage) log.info(`Tokens used: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out`);
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("Hugging Face response was cut off (max_tokens)");
  if (!choice?.message?.content) throw new Error("Hugging Face returned no output");
  return parseJson<T>(choice.message.content);
}

/** Speech-to-text of a recorded answer (the server extracts the audio track from the video). */
export async function hfTranscribe(file: Buffer, mimeType: string): Promise<string> {
  const res = await hfFetch(`${ROUTER}/hf-inference/models/${config.hfWhisperModel}`, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: new Uint8Array(file),
  });
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
