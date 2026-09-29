// JSON-file database for local development (used when DATABASE_URL is not set). Single server only.
import fs from "node:fs/promises";
import path from "node:path";
import type { Candidate, Job, StaffUser } from "../types";
import { type Db, seedJobs, upgrade } from "./shared";

const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "data");
const CANDIDATES = "candidates.json";
const JOBS = "jobs.json";
const USERS = "users.json";
const SETTINGS = "settings.json";

async function read<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ DATA_DIR, file), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function write(file: string, data: unknown) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(/*turbopackIgnore: true*/ DATA_DIR, file);
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
  const seed = await seedJobs();
  await write(JOBS, seed);
  return seed;
}

async function readCandidates() {
  const all = await read<Record<string, Candidate>>(CANDIDATES, {});
  for (const c of Object.values(all)) upgrade(c);
  return all;
}

export const jsonDb: Db = {
  async listCandidates() {
    return Object.values(await readCandidates());
  },
  async listCandidatesByStatus(...statuses) {
    return Object.values(await readCandidates()).filter((c) => statuses.includes(c.status));
  },
  async getCandidate(id) {
    return (await readCandidates())[id] ?? null;
  },
  async listCandidatesByEmail(email) {
    return Object.values(await readCandidates()).filter((c) => c.email === email);
  },
  async hasApplied(email, jobId) {
    return Object.values(await readCandidates()).some((c) => c.email === email && c.jobId === jobId);
  },
  addCandidate(candidate) {
    return update<Record<string, Candidate>, void>(CANDIDATES, {}, (all) => {
      all[candidate.id] = candidate;
    });
  },
  updateCandidate(id, fn) {
    return update<Record<string, Candidate>, Candidate | null>(CANDIDATES, {}, async (all) => {
      if (!all[id]) return null;
      await fn(upgrade(all[id]));
      return all[id];
    });
  },
  deleteCandidate(id) {
    return update<Record<string, Candidate>, Candidate | null>(CANDIDATES, {}, (all) => {
      const c = all[id] ?? null;
      delete all[id];
      return c;
    });
  },

  listUsers: () => read<StaffUser[]>(USERS, []),
  saveUser(user) {
    return update<StaffUser[], StaffUser>(USERS, [], (users) => {
      const i = users.findIndex((u) => u.id === user.id);
      if (i === -1) users.push(user);
      else users[i] = user;
      return user;
    });
  },
  updateUsers: (fn) => update(USERS, [] as StaffUser[], fn),

  listJobs: readJobs,
  async saveJob(job) {
    await readJobs(); // make sure the seed exists first
    return update<Job[], Job>(JOBS, [], (jobs) => {
      const i = jobs.findIndex((j) => j.id === job.id);
      if (i === -1) jobs.push(job);
      else jobs[i] = job;
      return job;
    });
  },
  async deleteJob(id) {
    await readJobs();
    return update<Job[], boolean>(JOBS, [], (jobs) => {
      const i = jobs.findIndex((j) => j.id === id);
      if (i === -1) return false;
      jobs.splice(i, 1);
      return true;
    });
  },

  async getSetting<T>(key: string) {
    return ((await read<Record<string, unknown>>(SETTINGS, {}))[key] as T) ?? null;
  },
  setSetting(key, value) {
    return update<Record<string, unknown>, void>(SETTINGS, {}, (all) => {
      if (value === null) delete all[key];
      else all[key] = value;
    });
  },
};
