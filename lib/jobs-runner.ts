// The app's background work, in one place. On an always-on server instrumentation.ts runs it on timers; on
// serverless hosting (Vercel) nothing stays running, so an external scheduler calls /api/cron every minute instead.
import { sendDueInvites } from "./access";
import { purgeDeactivatedAccounts } from "./auth";
import { purgeOldMedia, resumePendingEvaluations, sweepStaleInterviews } from "./candidates";
import { syncAllForms } from "./intake";
import { logger } from "./log";
import { store } from "./store";

const log = logger("cron");

/** Runs one step, logging (not throwing) its failure so the other steps still run. */
async function step(name: string, fn: () => Promise<unknown>) {
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, ms: Date.now() - start };
  } catch (err) {
    log.error(`${name} failed:`, err);
    return { name, ok: false, ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

const LAST_RUN_KEY = "jobsLastRun";
const MIN_GAP_MS = 60_000;

/**
 * Runs the jobs if they haven't run in the last minute (tracked in the database, so all server instances share it).
 * Called on page visits and health checks, so on serverless hosting the work keeps moving even when the external
 * scheduler is slow or missing. Never throws.
 */
export async function runJobsIfDue() {
  try {
    const last = await store.getSetting<string>(LAST_RUN_KEY);
    if (last && Date.now() - Date.parse(last) < MIN_GAP_MS) return;
    await store.setSetting(LAST_RUN_KEY, new Date().toISOString());
    await runScheduledJobs();
  } catch (err) {
    log.error("Background jobs failed:", err);
  }
}

/** Everything that should happen about once a minute. */
export async function runScheduledJobs() {
  return Promise.all([
    step("stale interviews", sweepStaleInterviews),
    // New applications first, then the decision emails that may already be due.
    step("forms and emails", async () => {
      await syncAllForms();
      await sendDueInvites();
    }),
    // Gradings stuck for 15 minutes (their serverless instance was stopped).
    step("stuck gradings", () => resumePendingEvaluations(15 * 60 * 1000)),
    step("cleanup", async () => {
      await purgeDeactivatedAccounts();
      await purgeOldMedia();
    }),
  ]);
}
