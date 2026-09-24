/** Provider-neutral request content; each provider adapter converts these to its own format. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string; title: string }
  | { kind: "document"; text: string; title: string }
  | { kind: "image"; base64: string }; // JPEG

export interface StructuredRequest {
  system: string;
  parts: Part[];
  /** JSON Schema the response must match. */
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
}
