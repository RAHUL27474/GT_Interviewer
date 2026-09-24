export type AiProvider = "claude" | "gemini" | "mock";

/**
 * Which AI runs the interview. AI_PROVIDER wins if set; otherwise the first key found:
 * ANTHROPIC_API_KEY -> claude, GEMINI_API_KEY -> gemini, neither -> mock (no AI, for UI testing).
 */
function pickProvider(): AiProvider {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "claude" || explicit === "gemini" || explicit === "mock") return explicit;
  const realKey = (k?: string) => Boolean(k && !k.includes("PASTE"));
  if (realKey(process.env.ANTHROPIC_API_KEY)) return "claude";
  if (realKey(process.env.GEMINI_API_KEY)) return "gemini";
  return "mock";
}

export const config = {
  companyName: process.env.COMPANY_NAME || "Careers",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  questionCount: Number(process.env.QUESTION_COUNT || 6),
  minutesPerQuestion: Number(process.env.MINUTES_PER_QUESTION || 3),
  /** Thinking time after the question is read out, before recording starts. */
  prepSeconds: Number(process.env.PREP_SECONDS || 20),
  aiProvider: pickProvider(),
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-5",
  claudeFallbacks: process.env.CLAUDE_FALLBACKS !== "off",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  maxTranscriptChars: 10000,
  maxResumeBytes: 5 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxSnapshotBytes: 200 * 1024,
  snapshotsPerAnswer: 3,
  resumeTypes: [".pdf", ".docx", ".txt"],
};

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  claude: "Claude",
  gemini: "Gemini (free tier, testing)",
  mock: "Test mode (no AI; placeholder questions and scores)",
};
