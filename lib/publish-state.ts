// Local JSON store for job-publish bookkeeping. Same pattern as lib/store.ts:
// one small file under data/, swapped for a database row if publishing ever
// needs to be shared across more than one process.
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const PUBLISHES = "job-publishes.json";

/**
 * What we remember about a job's remote listing, so a repeated publish updates
 * the same offer instead of creating a second one.
 *
 * `hash` is the fingerprint of the content we last sent. Without it every
 * publish would have to PATCH, and without the remote id we could not PATCH at
 * all, so this file is what makes sync() idempotent.
 */
export interface PublishRecord {
  /** Remote id, e.g. Recruitee's numeric offer id. */
  externalId: string;
  /** Public listing URL, so the admin panel can show where it went. */
  url: string | null;
  /** Title as last sent. Used only to detect a rename, never to match. */
  title: string;
  /** Fingerprint of the last payload we sent. */
  hash: string;
  /** Remote status as last observed. */
  status: string | null;
  updatedAt: string;
}

export type PublishState = Record<string, PublishRecord>;

const EMPTY: PublishState = {};

async function read(): Promise<PublishState> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, PUBLISHES), "utf8"));
  } catch (err) {
    // A missing file is the normal first-run case. A corrupt one is not, so it
    // surfaces rather than being silently reset and losing every remote id.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw err;
  }
}

async function write(state: PublishState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, PUBLISHES);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, target);
}

// Serialise read-modify-write on globalThis, mirroring lib/store.ts so a
// publish-all run and a single-job publish cannot clobber each other.
const g = globalThis as unknown as { __publishQueue?: Promise<unknown> };

export const publishState = {
  async get(jobId: string): Promise<PublishRecord | null> {
    return (await read())[jobId] ?? null;
  },

  async all(): Promise<PublishState> {
    return read();
  },

  /** Record a successful sync. */
  async set(jobId: string, record: Omit<PublishRecord, "updatedAt">): Promise<PublishRecord> {
    const full: PublishRecord = { ...record, updatedAt: new Date().toISOString() };
    const run = (g.__publishQueue ?? Promise.resolve()).then(async () => {
      const state = await read();
      state[jobId] = full;
      await write(state);
      return full;
    });
    g.__publishQueue = run.catch(() => {});
    return run;
  },

  /** Forget a remote listing, e.g. after it was deleted by hand in Recruitee. */
  async clear(jobId: string): Promise<void> {
    const run = (g.__publishQueue ?? Promise.resolve()).then(async () => {
      const state = await read();
      delete state[jobId];
      await write(state);
    });
    g.__publishQueue = run.catch(() => {});
    return run;
  },
};
