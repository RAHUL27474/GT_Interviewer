export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumePendingEvaluations, sweepStaleInterviews } = await import("./lib/candidates");
    const { purgeDeactivatedAccounts } = await import("./lib/auth");
    const { config } = await import("./lib/config");
    const { activeModel } = await import("./lib/ai");
    const { logger } = await import("./lib/log");
    const whisper = config.aiProvider === "hf" && config.hfWhisper ? config.hfWhisperModel : "browser only";
    logger("startup").info(`AI: ${config.aiProvider} (${activeModel()}), speech-to-text: ${whisper}`);
    // Don't block server startup on AI calls.
    resumePendingEvaluations().catch((err) => console.error("Resuming evaluations failed:", err));
    // Auto-submit interviews whose browser went silent (closed, crashed, or offline).
    setInterval(() => {
      sweepStaleInterviews().catch((err) => console.error("Interview sweep failed:", err));
    }, 20_000);
    // Delete staff accounts that have stayed deactivated too long: at startup, then hourly.
    const purge = () =>
      purgeDeactivatedAccounts()
        .then((deleted) => deleted.length && console.log(`Deleted deactivated accounts: ${deleted.join(", ")}`))
        .catch((err) => console.error("Account purge failed:", err));
    purge();
    setInterval(purge, 60 * 60 * 1000);
  }
}
