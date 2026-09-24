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
