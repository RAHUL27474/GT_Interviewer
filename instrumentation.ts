export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { purgeOldMedia, resumePendingEvaluations, sweepStaleInterviews } = await import("./lib/candidates");
    const { purgeDeactivatedAccounts } = await import("./lib/auth");
    const { config } = await import("./lib/config");
    const { activeModel, SPEECH_TO_TEXT_LABEL } = await import("./lib/ai");
    const { logger } = await import("./lib/log");
    const { databaseLabel } = await import("./lib/store");
    const { fileStorageLabel } = await import("./lib/files");
    const { emailLabel } = await import("./lib/email");
    const stt = SPEECH_TO_TEXT_LABEL[config.speechToText];
    logger("startup").info(`AI: ${config.aiProvider} (${activeModel()}), speech-to-text: ${stt}`);
    logger("startup").info(`Database: ${databaseLabel}; files: ${fileStorageLabel}; email: ${emailLabel}`);
    // Serverless (Vercel): nothing stays running between requests, so timers would be unreliable and a grading
    // resumed at every cold start could run twice. An external scheduler calls /api/cron every minute instead.
    if (process.env.VERCEL) {
      logger("startup").info("Serverless: background jobs run through /api/cron (CRON_SECRET)");
      return;
    }
    // Don't block server startup on AI calls.
    resumePendingEvaluations().catch((err) => console.error("Resuming evaluations failed:", err));
    // Auto-submit interviews whose browser went silent (closed, crashed, or offline).
    setInterval(() => {
      sweepStaleInterviews().catch((err) => console.error("Interview sweep failed:", err));
    }, 20_000);
    // Applications waiting for AI screening, and the decision emails that have come due.
    const { screenPendingApplications } = await import("./lib/applications");
    const { sendDueInvites } = await import("./lib/access");
    const { googleConnection, googleConfigured } = await import("./lib/google");
    const google = await googleConnection().catch(() => null);
    logger("startup").info(
      `Google: ${google ? `connected as ${google.email}` : googleConfigured ? "not connected (connect it in Jobs to send email)" : "GOOGLE_CLIENT_ID not set"}; ` +
        `decision emails ${config.decisionDelayMinutes} min after applying, ${config.interviewAccessHours} h to start`,
    );
    setInterval(() => {
      screenPendingApplications().catch((err) => console.error("Screening failed:", err));
    }, 60_000);
    setInterval(() => {
      sendDueInvites().catch((err) => console.error("Sending invites failed:", err));
    }, 30_000);
    // Hourly cleanup, also at startup: staff accounts deactivated too long, and interview media past
    // MEDIA_RETENTION_DAYS.
    const purge = () => {
      purgeDeactivatedAccounts()
        .then((deleted) => deleted.length && console.log(`Deleted deactivated accounts: ${deleted.join(", ")}`))
        .catch((err) => console.error("Account purge failed:", err));
      purgeOldMedia().catch((err) => console.error("Media cleanup failed:", err));
    };
    purge();
    setInterval(purge, 60 * 60 * 1000);
  }
}
