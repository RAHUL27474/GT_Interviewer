import { Worker } from "bullmq";
import { config } from "../lib/config";
import { markScreeningFailed, processResumeScreening } from "../lib/screening";
import { disposeScreeningBridge, warmScreeningBridge } from "../lib/screening-engine";
import { redisConnection, RESUME_SCREENING_QUEUE } from "../lib/screening-queue";

// Load the embedding model before taking any job, so the first candidate does
// not pay the several-second load cost. A failure here is not fatal: screening
// falls back to the LLM screener.
void warmScreeningBridge().then((ready) => {
  console.info(ready ? "Python screening bridge ready." : "Python screening bridge unavailable; using the LLM screener.");
});

const worker = new Worker(
  RESUME_SCREENING_QUEUE,
  async (job) => processResumeScreening(String(job.data.candidateId)),
  { connection: redisConnection(), concurrency: config.screeningWorkerConcurrency },
);

worker.on("completed", (job) => console.info(`Resume screening completed: ${job.data.candidateId}`));
worker.on("failed", async (job, error) => {
  if (!job) return;
  console.error(`Resume screening attempt failed for ${job.data.candidateId}:`, error);
  if (job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
    await markScreeningFailed(String(job.data.candidateId), error);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    disposeScreeningBridge();
    void worker.close().then(() => process.exit(0));
  });
}

console.info("Resume screening worker started.");