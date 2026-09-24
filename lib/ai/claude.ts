import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { Part, StructuredRequest } from "./types";

let client: Anthropic | null = null;

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

/** One structured-output request to Claude. Returns the parsed JSON matching `schema`. */
export async function claudeStructured<T>(req: StructuredRequest): Promise<T> {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: config.claudeModel,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
    // If a safety classifier declines, the API re-runs the request on a fallback model.
    ...(config.claudeFallbacks && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    system: req.system,
    messages: [{ role: "user", content: req.parts.map(toBlock) }],
  });

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
  return JSON.parse(text) as T;
}
