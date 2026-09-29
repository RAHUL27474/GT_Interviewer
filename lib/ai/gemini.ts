// Google Gemini adapter: free tier, used for testing before switching to Claude.
import { GoogleGenAI, type Part as GeminiPart } from "@google/genai";
import { config } from "../config";
import type { Part, StructuredRequest } from "./types";

let client: GoogleGenAI | null = null;

function toPart(p: Part): GeminiPart {
  switch (p.kind) {
    case "text":
      return { text: p.text };
    case "pdf":
      return { inlineData: { mimeType: "application/pdf", data: p.base64 } };
    case "document":
      return { text: `<document title="${p.title}">\n${p.text}\n</document>` };
    case "image":
      return { inlineData: { mimeType: "image/jpeg", data: p.base64 } };
  }
}

const TRANSCRIBE_PROMPT = `Transcribe everything the candidate says in this interview answer recording, word for word. \
They may speak Indian English and mix in some Hindi; write Hindi words in Latin script. Output only the transcript, \
with no timestamps, speaker labels or comments. If nobody speaks, output nothing.`;

/** Speech-to-text of a recorded answer. The video is uploaded through the Files API (too big to send inline). */
export async function geminiTranscribe(file: Buffer, mimeType: string): Promise<string> {
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  let uploaded = await client.files.upload({ file: new Blob([new Uint8Array(file)], { type: mimeType }), config: { mimeType } });
  try {
    // Video files are processed before they can be used; this usually takes a few seconds.
    const deadline = Date.now() + 120_000;
    while (uploaded.state === "PROCESSING" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      uploaded = await client.files.get({ name: uploaded.name! });
    }
    if (uploaded.state !== "ACTIVE") throw new Error(`Gemini could not process the video (${uploaded.state})`);
    const response = await client.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: "user", parts: [{ fileData: { fileUri: uploaded.uri, mimeType } }, { text: TRANSCRIBE_PROMPT }] }],
    });
    return (response.text ?? "").trim();
  } finally {
    if (uploaded.name) await client.files.delete({ name: uploaded.name }).catch(() => {});
  }
}

/** One structured-output request to Gemini. Returns the parsed JSON matching `schema`. */
export async function geminiStructured<T>(req: StructuredRequest): Promise<T> {
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  const response = await client.models.generateContent({
    model: config.geminiModel,
    contents: [{ role: "user", parts: req.parts.map(toPart) }],
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
    },
  });
  const text = response.text;
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason ?? "empty response";
    throw new Error(`Gemini returned no output (${reason})`);
  }
  return JSON.parse(text) as T;
}
