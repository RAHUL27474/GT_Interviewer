// Tiny JSON-file store. Good for a few thousand candidates; swap for a real DB beyond that.
import fs from "node:fs/promises";
import path from "node:path";
import type { Candidate, Job } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
export const RESUME_DIR = path.join(DATA_DIR, "resumes");
/** Per-candidate folder of answer videos and webcam snapshots. */
export const mediaDir = (candidateId: string) => path.join(DATA_DIR, "videos", candidateId);
const CANDIDATES = "candidates.json";
const JOBS = "jobs.json";

async function read<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function write(file: string, data: unknown) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, file);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, target);
}

// Serialize every read-modify-write so concurrent requests can't overwrite each other.
// Kept on globalThis so all route bundles share one queue.
const g = globalThis as unknown as { __storeQueue?: Promise<unknown> };
function update<T, R>(file: string, fallback: T, fn: (data: T) => R | Promise<R>): Promise<R> {
  const run = (g.__storeQueue ?? Promise.resolve()).then(async () => {
    const data = await read(file, fallback);
    const result = await fn(data);
    await write(file, data);
    return result;
  });
  g.__storeQueue = run.catch(() => {});
  return run;
}

async function readJobs(): Promise<Job[]> {
  const jobs = await read<Job[] | null>(JOBS, null);
  if (jobs) return jobs;
  // First run: seed from config.
  const seed: Job[] = JSON.parse(await fs.readFile(path.join(process.cwd(), "config/jobs.seed.json"), "utf8"));
  await write(JOBS, seed);
  return seed;
}

/**
 * Upgrades records saved by older versions of the app, in place.
 * Before live proctoring, only a tab-switch count was stored; keep it as a single event.
 */
function upgrade(c: Candidate): Candidate {
  if (!c.proctoring) {
    const legacy = c as Candidate & { integrity?: { tabSwitches?: number } };
    const switches = legacy.integrity?.tabSwitches ?? 0;
    c.proctoring = {
      events: switches
        ? [
            {
              type: "left_window",
              at: c.completedAt ?? c.createdAt,
              questionIndex: null,
              detail: `${switches} tab switch(es), recorded before live proctoring was added`,
              snapshot: null,
            },
          ]
        : [],
    };
    delete legacy.integrity;
  }
  return c;
}

async function readCandidates() {
  const all = await read<Record<string, Candidate>>(CANDIDATES, {});
  for (const c of Object.values(all)) upgrade(c);
  return all;
}

export const store = {
  async listCandidates(): Promise<Candidate[]> {
    return Object.values(await readCandidates());
  },
  async getCandidate(id: string): Promise<Candidate | null> {
    return (await readCandidates())[id] ?? null;
  },
  addCandidate(candidate: Candidate) {
    return update<Record<string, Candidate>, void>(CANDIDATES, {}, (all) => {
      all[candidate.id] = candidate;
    });
  },
  /** fn mutates the candidate in place. Returns the updated candidate, or null if missing. */
  updateCandidate(id: string, fn: (c: Candidate) => void | Promise<void>) {
    return update<Record<string, Candidate>, Candidate | null>(CANDIDATES, {}, async (all) => {
      if (!all[id]) return null;
      await fn(upgrade(all[id]));
      return all[id];
    });
  },

  listJobs: readJobs,
  async saveJob(job: Job) {
    await readJobs(); // make sure the seed exists first
    return update<Job[], Job>(JOBS, [], (jobs) => {
      const i = jobs.findIndex((j) => j.id === job.id);
      if (i === -1) jobs.push(job);
      else jobs[i] = job;
      return job;
    });
  },
};
