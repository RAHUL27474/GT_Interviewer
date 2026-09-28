export type AiProvider = "groq" | "claude" | "gemini" | "mock";

/**
 * Which AI runs the interview. AI_PROVIDER wins if set; otherwise the first key found:
 * GROQ_API_KEY -> groq, ANTHROPIC_API_KEY -> claude, GEMINI_API_KEY -> gemini, neither -> mock.
 */
function pickProvider(): AiProvider {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "groq" || explicit === "claude" || explicit === "gemini" || explicit === "mock") return explicit;
  const realKey = (k?: string) => Boolean(k && !k.includes("PASTE") && !k.includes("REPLACE"));
  if (realKey(process.env.GROQ_API_KEY)) return "groq";
  if (realKey(process.env.ANTHROPIC_API_KEY)) return "claude";
  if (realKey(process.env.GEMINI_API_KEY)) return "gemini";
  return "mock";
}

/**
 * Read a numeric env var, falling back when it is missing or unusable.
 *
 * Every numeric setting goes through here. A bare `Number(process.env.X || n)`
 * turns `QUESTION_COUNT=abc` into NaN, which then reaches an AI prompt as
 * "write exactly NaN questions" and silently breaks the interview.
 */
function numberFromEnv(key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.warn(`${key}="${raw}" is not a number; using ${fallback}.`);
    return fallback;
  }
  if (value < min || value > max) {
    console.warn(`${key}=${value} is outside ${min}-${max}; using ${fallback}.`);
    return fallback;
  }
  return value;
}

/** Read a boolean env var. Anything not "true"/"1"/"yes" is false. */
function boolFromEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  console.warn(`${key}="${raw}" is not a boolean; using ${fallback}.`);
  return fallback;
}

export const config = {
  companyName: process.env.COMPANY_NAME || "Galaxy Toyota",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET || "",
  objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT || "",
  objectStorageRegion: process.env.OBJECT_STORAGE_REGION || "us-east-1",
  objectStorageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY || "",
  objectStorageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY || "",
  /**
   * Send a resume to the AI interview at or above this score.
   *
   * The default is 75, not the upstream Python model's 90: its own docs note
   * that cosine similarity for genuinely related professional text lands around
   * 0.6-0.75, which rescales to roughly 80-88. A 90 cut-off would reject
   * effectively every real candidate.
   */
  resumeScreenPassScore: numberFromEnv("RESUME_SCREEN_PASS_SCORE", 75, 0, 100),
  /** Below this score a resume still needs a person, but is not auto-advanced. */
  resumeScreenReviewScore: numberFromEnv("RESUME_SCREEN_REVIEW_SCORE", 50, 0, 100),
  /**
   * Use the Python model in src/resume_screening instead of an LLM judge. Falls
   * back to the LLM screener automatically if the bridge cannot start.
   */
  screeningBridgeEnabled: (process.env.SCREENING_BRIDGE_ENABLED ?? "true").trim().toLowerCase() !== "false",
  /** Explicit interpreter path. Empty auto-detects ../.venv, then PATH. */
  screeningBridgePython: process.env.SCREENING_BRIDGE_PYTHON || "",
  screeningBridgeTimeoutMs: numberFromEnv("SCREENING_BRIDGE_TIMEOUT_MS", 120_000, 1_000, 900_000),
  /**
   * How many resumes the BullMQ worker screens at once.
   *
   * Each concurrent job holds the Python bridge, which holds one embedding model.
   * Raising this past the memory a single model needs trades throughput for the
   * worker being OOM-killed mid-batch, so the ceiling is deliberately low.
   */
  screeningWorkerConcurrency: numberFromEnv("SCREENING_WORKER_CONCURRENCY", 2, 1, 16),
  /** Shown to candidates whose interview was interrupted, e.g. "hr@company.com or +91 98xxxxxxxx". */
  hrContact: process.env.HR_CONTACT || "the HR team",

  // ---- Notifications ----
  // Off unless a provider is configured, so a fresh checkout sends nothing and
  // cannot fail a registration.
  notifyEmailProvider: (process.env.NOTIFY_EMAIL_PROVIDER || "none").trim().toLowerCase(),
  notifyEmailApiKey: process.env.NOTIFY_EMAIL_API_KEY || "",
  /** Absolute origin used to build the interview link, e.g. https://apply.example.com */
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  /** Sender shown to the candidate. Both providers reject unverified senders. */
  notifyFromEmail: process.env.NOTIFY_FROM_EMAIL || "",
  notifyFromName: process.env.NOTIFY_FROM_NAME || process.env.COMPANY_NAME || "Hiring Team",
  /** Where HR is told a candidate is waiting. Falls back to the sender. */
  notifyHrEmail: process.env.NOTIFY_HR_EMAIL || "",
  /** An in-progress interview with no heartbeat for this long is auto-submitted as interrupted. */
  heartbeatTimeoutSec: numberFromEnv("HEARTBEAT_TIMEOUT_SECONDS", 90, 10, 3600),
  /** Leaving the tab or fullscreen: this many warnings, then the next time ends the interview. */
  maxWarnings: numberFromEnv("MAX_WARNINGS", 2, 0, 20),
  /** Leaving the tab or fullscreen for longer than this ends the interview. */
  awayGraceSeconds: numberFromEnv("AWAY_GRACE_SECONDS", 10, 0, 300),
  maxProctorEvents: 300,
  /** One screen-recording chunk (~10 s at low bitrate is well under this). */
  maxScreenChunkBytes: 20 * 1024 * 1024,
  adminPassword: process.env.ADMIN_PASSWORD || "",
  questionCount: numberFromEnv("QUESTION_COUNT", 6, 1, 50),
  minutesPerQuestion: numberFromEnv("MINUTES_PER_QUESTION", 3, 0.5, 60),
  /** Thinking time after the question is read out, before recording starts. */
  prepSeconds: numberFromEnv("PREP_SECONDS", 20, 0, 600),
  aiProvider: pickProvider(),
  groqApiKey: process.env.GROQ_API_KEY || "",
  /**
   * Default is gpt-oss-120b rather than a Qwen model. Two reasons, both found by
   * running the real question-generation request rather than a toy one:
   *
   * 1. It is one of the two models Groq documents as supporting `strict: true`
   *    (constrained decoding, so schema-compliant output is guaranteed). Qwen
   *    3.8 27B is best-effort only, and in practice returned 400 "Failed to
   *    validate JSON" for the interview question schema.
   * 2. Qwen 3.8 27B rejected the full request outright with "Request too large",
   *    because a real resume plus job description plus six questions with
   *    rubrics does not fit its budget. gpt-oss-120b returns all six.
   *
   * gpt-oss-20b is the other strict-capable model but is noticeably weaker: asked
   * for six questions it returned one. Size here is the point, not a preference.
   */
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
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
  voiceGatewayUrl: process.env.VOICE_GATEWAY_URL || "http://127.0.0.1:8000",
  voiceGatewayApiKey: process.env.VOICE_GATEWAY_API_KEY || "",

  /* -------------------------------------------------------------- Careers */

  /**
   * Public origin of this deployment, no trailing slash.
   *
   * The careers page, its feeds and every schema.org/JobPosting URL are
   * absolute, and search engines discard a JobPosting whose `url` is relative.
   * Without this the JSON-LD would point at localhost and never get indexed.
   */
  siteUrl: (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, ""),
  /** Shown to candidates who need a human, and used as the feed's managing editor. */
  careersEmail: process.env.CAREERS_EMAIL || "careers@example.com",
  /** Days a posting stays listed once published. Recruitee caps premium jobs at 90. */
  jobPostingValidDays: numberFromEnv("JOB_POSTING_VALID_DAYS", 60, 1, 365),

  /* ------------------------------------------------- Job board publishing */

  /**
   * Where active jobs get pushed. "none" keeps everything on our own careers
   * page, which is a complete, valid setup: schema.org/JobPosting plus the
   * feeds in /careers are what Google for Jobs and most aggregators read.
   */
  jobPublisher: (process.env.JOB_PUBLISHER || "none").trim().toLowerCase(),
  /**
   * Log what would be sent and never call a third party. Defaults to true so a
   * half-finished RECRUITEE_API_TOKEN cannot publish a real job board by
   * accident. Set JOB_PUBLISH_DRY_RUN=false once the dry-run output looks right.
   */
  jobPublishDryRun: boolFromEnv("JOB_PUBLISH_DRY_RUN", true),

  /** Recruitee company id, from Settings > Personal API Tokens. A subdomain also works. */
  recruiteeCompanyId: process.env.RECRUITE_COMPANY_ID || "",
  /**
   * Recruitee API root. Override to https://api.rc.recruitee.com to rehearse
   * against their release-candidate environment before touching production.
   */
  recruiteeApiBase: (process.env.RECRUITE_API_BASE || "https://api.recruitee.com").replace(/\/+$/, ""),
  /**
   * Recruitee Personal API token. This is a full-permission credential for the
   * generating user's account, not a scoped token, so it stays server-side.
   */
  recruiteeApiToken: process.env.RECRUITE_API_TOKEN || "",
  /**
   * Recruitee requires every offer to reference a location id, and the catalogue
   * is per-company. This is used when a job's location text cannot be matched
   * against the account's own location list.
   */
  recruiteeFallbackLocationId: numberFromEnv("RECRUITE_LOCATION_ID", 0, 0, Number.MAX_SAFE_INTEGER),
  /** Rate limit backoff. Trial accounts are capped at 5 requests/minute. */
  recruiteeRequestDelayMs: numberFromEnv("RECRUITE_REQUEST_DELAY_MS", 250, 0, 60_000),
  /** Give up on a publish run after this long rather than blocking an admin request. */
  jobPublishTimeoutMs: numberFromEnv("JOB_PUBLISH_TIMEOUT_MS", 60_000, 5_000, 600_000),

  /* ------------------------------------------------- Candidate invitation */

  /**
   * How long a shortlisted candidate has to complete their interview, shown as
   * a deadline on the invitation screen.
   *
   * A deadline is a real pressure on someone who has a job to keep. It is here
   * because an open invitation that never expires quietly becomes a queue of
   * people who are interested and then find the link dead. 48 hours spans a
   * weekend without expiring the invitation before anyone has seen it.
   */
  interviewInviteDeadlineHours: numberFromEnv("INTERVIEW_INVITE_DEADLINE_HOURS", 48, 1, 720),
  /**
   * Focus areas shown on the invitation and brief screens. Four is what fits
   * without turning into a wall of text; more would just restate the JD.
   */
  interviewTopicsMax: numberFromEnv("INTERVIEW_TOPICS_MAX", 4, 1, 10),
};

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  groq: `Groq (${process.env.GROQ_MODEL || "qwen/qwen3.8-27b"})`,
  claude: "Claude",
  gemini: "Gemini (free tier, testing)",
  mock: "Test mode (no AI; placeholder questions and scores)",
};
