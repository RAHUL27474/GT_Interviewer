import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { Part, StructuredRequest } from "./types";

let client: Anthropic | null = null;

function getClient() {
  // 4 minutes per attempt: grading with webcam snapshots at high effort can take a couple of minutes, and this keeps a
  // request inside a 5-minute serverless function. The SDK retries 429/5xx/network errors twice.
  client ??= new Anthropic({ timeout: 240_000, maxRetries: 2 });
  return client;
}

function toBlock(p: Part): Anthropic.Beta.BetaContentBlockParam {
  switch (p.kind) {
    case "text":
      return { type: "text", text: p.text };
    case "pdf":
      return { type: "document", title: p.title, source: { type: "base64", media_type: "application/pdf", data: p.base64 } };
    case "document":
      return { type: "document", title: p.title, source: { type: "text", media_type: "text/plain", data: p.text } };
    case "image":
      return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.base64 } };
  }
}

/** Turns API errors into messages HR and the logs can act on. */
function explain(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error("ANTHROPIC_API_KEY is invalid or has been revoked.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error(`This Anthropic key can't use ${config.claudeModel}: ${err.message}`);
  if (err instanceof Anthropic.NotFoundError) return new Error(`Claude model "${config.claudeModel}" wasn't found (check CLAUDE_MODEL).`);
  if (err instanceof Anthropic.RateLimitError) return new Error("Claude rate limit reached; it will be retried on the next run.");
  if (err instanceof Anthropic.BadRequestError) {
    const m = err.message;
    if (/credit balance/i.test(m)) return new Error("The Anthropic account is out of credit (Plans & Billing in the Claude Console).");
    return new Error(`Claude rejected the request: ${m}`);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new Error("Claude took too long to answer; it will be retried.");
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error ${err.status ?? ""}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

/** One structured-output request to Claude. Returns the parsed JSON matching `schema`. */
export async function claudeStructured<T>(req: StructuredRequest): Promise<T> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await getClient().beta.messages.create({
      model: config.claudeModel,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
      // If a safety classifier declines, the API re-runs the request on a fallback model.
      ...(config.claudeFallbacks && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      system: req.system,
      messages: [{ role: "user", content: req.parts.map(toBlock) }],
    });
  } catch (err) {
    throw explain(err);
  }

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined the request (${response.stop_details?.category ?? "unknown"})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude response was cut off (max_tokens)");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

/** Checks the key and model without spending tokens (Models API). */
export async function claudeKeyCheck(): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const model = await getClient().models.retrieve(config.claudeModel);
    return { ok: true, model: model.display_name };
  } catch (err) {
    return { ok: false, error: explain(err).message };
  }
}
