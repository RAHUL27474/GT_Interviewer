export const config = {
  companyName: process.env.COMPANY_NAME || "Careers",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  questionCount: Number(process.env.QUESTION_COUNT || 6),
  minutesPerQuestion: Number(process.env.MINUTES_PER_QUESTION || 3),
  /** Thinking time after the question is read out, before recording starts. */
  prepSeconds: Number(process.env.PREP_SECONDS || 20),
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-5",
  claudeFallbacks: process.env.CLAUDE_FALLBACKS !== "off",
  maxTranscriptChars: 10000,
  maxResumeBytes: 5 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxSnapshotBytes: 200 * 1024,
  snapshotsPerAnswer: 3,
  resumeTypes: [".pdf", ".docx", ".txt"],
};
