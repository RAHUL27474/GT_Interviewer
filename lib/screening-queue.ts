import { Queue } from "bullmq";
import { config } from "./config";

export const RESUME_SCREENING_QUEUE = "resume-screening";

const globalQueue = globalThis as typeof globalThis & { __resumeScreeningQueue?: Queue };

export function redisConnection() {
  if (!config.redisUrl) throw new Error("REDIS_URL is required for queued resume screening.");
  const url = new URL(config.redisUrl);
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(Number.isInteger(database) && database > 0 ? { db: database } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export function resumeScreeningQueue(): Queue {
  globalQueue.__resumeScreeningQueue ??= new Queue(RESUME_SCREENING_QUEUE, {
    connection: redisConnection(),
  });
  return globalQueue.__resumeScreeningQueue;
}

export async function enqueueResumeScreening(candidateId: string): Promise<void> {
  await resumeScreeningQueue().add(
    "screen-resume",
    { candidateId },
    {
      jobId: candidateId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
}