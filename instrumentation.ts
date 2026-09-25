export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumePendingEvaluations, sweepStaleInterviews } = await import("./lib/candidates");
    // Don't block server startup on AI calls.
    resumePendingEvaluations().catch((err) => console.error("Resuming evaluations failed:", err));
    // Auto-submit interviews whose browser went silent (closed, crashed, or offline).
    setInterval(() => {
      sweepStaleInterviews().catch((err) => console.error("Interview sweep failed:", err));
    }, 20_000);
  }
}
