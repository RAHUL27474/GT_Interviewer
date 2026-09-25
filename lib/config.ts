export type AiProvider = "claude" | "gemini" | "hf" | "mock";

const realKey = (k?: string) => Boolean(k && !k.includes("PASTE"));

/**
 * Which AI runs the interview. A real ANTHROPIC_API_KEY always wins, so adding it switches everything to Claude.
 * Otherwise AI_PROVIDER if set, else the first key found: GEMINI_API_KEY -> gemini, HF_TOKEN -> hf,
 * none -> mock (no AI, for UI testing).
 */
function pickProvider(): AiProvider {
  if (realKey(process.env.ANTHROPIC_API_KEY)) return "claude";
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "gemini" || explicit === "hf" || explicit === "mock") return explicit;
  if (realKey(process.env.GEMINI_API_KEY)) return "gemini";
  if (realKey(process.env.HF_TOKEN)) return "hf";
  return "mock";
}

export const config = {
  companyName: process.env.COMPANY_NAME || "Careers",
  /** Shown to candidates whose interview was interrupted, e.g. "hr@company.com or +91 98xxxxxxxx". */
  hrContact: process.env.HR_CONTACT || "the HR team",
  /** An in-progress interview with no heartbeat for this long is auto-submitted as interrupted. */
  heartbeatTimeoutSec: Number(process.env.HEARTBEAT_TIMEOUT_SECONDS || 90),
  /** Leaving the tab or fullscreen: this many warnings, then the next time ends the interview. */
  maxWarnings: Number(process.env.MAX_WARNINGS || 2),
  /** Leaving the tab or fullscreen for longer than this ends the interview. */
  awayGraceSeconds: Number(process.env.AWAY_GRACE_SECONDS || 10),
  /** Looking away from the screen: this many warnings, then the next time ends the interview. */
  maxLookAwayWarnings: Number(process.env.MAX_LOOK_AWAY_WARNINGS || 2),
  /** Another person on camera: one warning with this countdown; a second appearance ends the interview. */
  secondPersonGraceSeconds: Number(process.env.SECOND_PERSON_GRACE_SECONDS || 5),
  maxProctorEvents: 300,
  /** Deactivated staff accounts are deleted automatically after this many days. */
  accountDeleteAfterDays: Number(process.env.ACCOUNT_DELETE_AFTER_DAYS || 15),
  /** One screen-recording chunk (~10 s at low bitrate is well under this). */
  maxScreenChunkBytes: 20 * 1024 * 1024,
  /** Password for the first account (Super Admin), created automatically on a fresh install. */
  adminPassword: process.env.ADMIN_PASSWORD || "",
  /** Email (login) of the first account, a Super Admin. MANAGER_EMAIL is accepted for older .env files. */
  superAdminEmail: (process.env.SUPER_ADMIN_EMAIL || process.env.MANAGER_EMAIL || "superadmin@company.com")
    .trim()
    .toLowerCase(),
  questionCount: Number(process.env.QUESTION_COUNT || 6),
  minutesPerQuestion: Number(process.env.MINUTES_PER_QUESTION || 3),
  /** Thinking time after the question is read out, before recording starts. */
  prepSeconds: Number(process.env.PREP_SECONDS || 5),
  aiProvider: pickProvider(),
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-5",
  claudeFallbacks: process.env.CLAUDE_FALLBACKS !== "off",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  hfToken: process.env.HF_TOKEN || "",
  /** Must accept images (webcam snapshots are sent for proctoring notes). */
  hfModel: process.env.HF_MODEL || "Qwen/Qwen2.5-VL-72B-Instruct",
  /** Most images the HF provider accepts per request; extra webcam snapshots are left out of grading. */
  hfMaxImages: Number(process.env.HF_MAX_IMAGES || 5),
  /** Speech-to-text model; re-transcribes each answer video when the hf provider is active. */
  hfWhisperModel: process.env.HF_WHISPER_MODEL || "openai/whisper-large-v3-turbo",
  hfWhisper: process.env.HF_WHISPER !== "off",
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
  hf: "Hugging Face (free credits, testing)",
  mock: "Test mode (no AI; placeholder questions and scores)",
};
