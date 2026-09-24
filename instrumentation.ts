export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumePendingEvaluations } = await import("./lib/candidates");
    // Don't block server startup on Claude calls.
    resumePendingEvaluations().catch((err) => console.error("Resuming evaluations failed:", err));
  }
}
