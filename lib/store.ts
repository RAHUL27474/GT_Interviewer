// Tiny JSON-file store. Good for a few thousand candidates; swap for a real DB beyond that.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { config } from "./config";
import { getDatabasePool } from "./database";
import type { Candidate, Job, ResumeScreening, ResumeScreeningReport } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
export const RESUME_DIR = path.join(DATA_DIR, "resumes");
/** Per-candidate folder of answer videos and webcam snapshots. */
export const mediaDir = (candidateId: string) => path.join(DATA_DIR, "videos", candidateId);
const CANDIDATES = "candidates.json";
const JOBS = "jobs.json";

async function read<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    // Tolerate a leading byte-order mark. Plenty of ordinary tools write one -
    // PowerShell's Set-Content -Encoding UTF8, Excel's CSV/JSON export, Windows
    // Notepad - and JSON.parse rejects "\uFEFF{}" outright. Without this a single
    // stray byte 500s every route that touches the store, including the 20s
    // interview sweeper, so a bad file write is indistinguishable from a broken
    // app. The BOM carries no information for JSON; it is safe to drop.
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function write(file: string, data: unknown) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, file);
  // A unique temp name per write, not one shared "<file>.tmp".
  //
  // The shared name is a race: two writers both create the same temp file, the
  // first rename consumes it, and the second rename fails with ENOENT because the
  // file it is renaming is already gone. `readJobs` used to do exactly that on a
  // cold start, where every concurrent request seeds at once. On Render the
  // container is always cold, so it was not a rare edge case but every deploy.
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, target);
  } catch (err) {
    // Never leave a partial temp file behind for the next write to trip over.
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

// Serialize every read-modify-write so concurrent requests can't overwrite each other.
// Kept on globalThis so all route bundles share one queue.
const g = globalThis as unknown as { __storeQueue?: Promise<unknown> };
/**
 * Run a serialized read-modify-write against one file.
 *
 * `fn` receives the current value and returns the caller's result. Normally what
 * gets written back is that same value, mutated in place by `fn`. Pass `replace`
 * when the callback could not mutate in place and returns the value to store
 * instead, which is how a missing file gets seeded: there is nothing on disk to
 * mutate, so the callback has to hand back what should be written.
 */
function update<T, R>(
  file: string,
  fallback: T,
  fn: (data: T) => R | Promise<R>,
  replace = false,
): Promise<R> {
  const run = (g.__storeQueue ?? Promise.resolve()).then(async () => {
    const data = await read(file, fallback);
    const result = await fn(data);
    await write(file, replace ? result : data);
    return result;
  });
  g.__storeQueue = run.catch(() => {});
  return run;
}

/**
 * The job list, seeded from config on first run.
 *
 * The seed goes through the same `update` queue as every other write. Reading
 * outside it and writing inside it is what made a cold start fail: a container
 * with no `data/jobs.json` sends several requests at once, and each one read
 * ENOENT and tried to seed, so N requests raced to write one file. On a long
 * lived server the window is tiny. On Render the container is cold on every
 * deploy and every spin-down, so the first page view after each one hit it.
 */
async function readJobs(): Promise<Job[]> {
  const jobs = await read<Job[] | null>(JOBS, null);
  if (jobs) return jobs;
  return update<Job[] | null, Job[]>(
    JOBS,
    null,
    (current) => {
      // Re-read inside the queue: a request that queued behind this one may have
      // already seeded it, and re-seeding would drop any job saved since.
      if (current) return current;
      return JSON.parse(
        fsSync.readFileSync(path.join(process.cwd(), "config/jobs.seed.json"), "utf8"),
      ) as Job[];
    },
    true,
  );
}

/**
 * A screening report as it may be found on disk.
 *
 * These fields have been present since the first version, so they are always
 * required. Everything the Python model added later is optional, because a
 * database written by an older build will not have it.
 */
type StoredScreening = ResumeScreening &
  Pick<ResumeScreeningReport, "recommendation"> &
  Partial<Omit<ResumeScreeningReport, keyof ResumeScreening | "recommendation">>;

/**
 * Fills in screening fields that older records predate.
 *
 * Reports written before the Python model was wired in carry only
 * score/summary/strengths/gaps. They are still valid decisions, so they are
 * backfilled rather than discarded, and the admin drawer keeps rendering.
 *
 * Exported for tests: this is the seam that keeps a database written by an older
 * build readable, which is the easiest thing to break silently.
 */
export function upgradeScreening(c: Candidate, report?: StoredScreening | null): ResumeScreeningReport | null {
  const existing = report === undefined ? c.resumeScreening : report;
  if (!existing) return null;
  const score = existing.score ?? 0;
  const threshold = config.resumeScreenPassScore;
  return {
    ...existing,
    engine: existing.engine ?? "llm",
    // A record that pre-dates the three-state decision is reclassified from its
    // score, so an old SHORTLISTED and a new SHORTLISTED agree.
    status: existing.status ?? (score >= threshold ? "SHORTLISTED" : "HR_REVIEW"),
    scores: existing.scores ?? {
      requiredSkills: 0,
      experience: 0,
      education: 0,
      projects: 0,
      semantic: 0,
      finalScore: score,
      nativeScreeningScore: null,
      semanticSimilarity: null,
      skillCoveragePercent: null,
      threshold,
      reviewThreshold: config.resumeScreenReviewScore,
      marginToThreshold: Math.round((score - threshold) * 10) / 10,
    },
    requiredSkills: existing.requiredSkills ?? [],
    matchedSkills: existing.matchedSkills ?? [],
    missingSkills: existing.missingSkills ?? [],
    bonusSkills: existing.bonusSkills ?? [],
    recommendedNextStep: existing.recommendedNextStep ?? "HR Manual Review",
  };
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
  if (c.profileComplete === undefined) {
    c.profileComplete = Boolean(c.email && c.fullName && c.phone && c.joiningCategory);
  }
  c.resumeScreening = upgradeScreening(c) ?? undefined;
  return c;
}

async function readCandidates() {
  const all = await read<Record<string, Candidate>>(CANDIDATES, {});
  for (const c of Object.values(all)) upgrade(c);
  return all;
}

export const store = {
  async listCandidates(): Promise<Candidate[]> {
    if (config.databaseUrl) {
      const result = await getDatabasePool().query<{ data: Candidate }>(
        "SELECT data FROM candidates ORDER BY created_at DESC",
      );
      return result.rows.map(({ data }) => upgrade(data));
    }
    return Object.values(await readCandidates());
  },
  async getCandidate(id: string): Promise<Candidate | null> {
    if (config.databaseUrl) {
      const result = await getDatabasePool().query<{ data: Candidate }>(
        "SELECT data FROM candidates WHERE id = $1",
        [id],
      );
      return result.rows[0] ? upgrade(result.rows[0].data) : null;
    }
    return (await readCandidates())[id] ?? null;
  },
  addCandidate(candidate: Candidate) {
    if (config.databaseUrl) {
      return getDatabasePool()
        .query(
          "INSERT INTO candidates (id, email, job_id, status, created_at, data) VALUES ($1, $2, $3, $4, $5, $6)",
          [candidate.id, candidate.email, candidate.jobId, candidate.status, candidate.createdAt, candidate],
        )
        .then(() => undefined);
    }
    return update<Record<string, Candidate>, void>(CANDIDATES, {}, (all) => {
      all[candidate.id] = candidate;
    });
  },
  /** fn mutates the candidate in place. Returns the updated candidate, or null if missing. */
  async updateCandidate(id: string, fn: (c: Candidate) => void | Promise<void>) {
    if (config.databaseUrl) {
      const client = await getDatabasePool().connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{ data: Candidate }>(
          "SELECT data FROM candidates WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (!result.rows[0]) {
          await client.query("COMMIT");
          return null;
        }
        const candidate = upgrade(result.rows[0].data);
        await fn(candidate);
        await client.query(
          "UPDATE candidates SET email = $2, job_id = $3, status = $4, data = $5 WHERE id = $1",
          [id, candidate.email, candidate.jobId, candidate.status, candidate],
        );
        await client.query("COMMIT");
        return candidate;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    return update<Record<string, Candidate>, Candidate | null>(CANDIDATES, {}, async (all) => {
      if (!all[id]) return null;
      await fn(upgrade(all[id]));
      return all[id];
    });
  },

  async listJobs(): Promise<Job[]> {
    if (config.databaseUrl) {
      const pool = getDatabasePool();
      const result = await pool.query<{ data: Job }>("SELECT data FROM jobs ORDER BY id");
      if (result.rows.length) return result.rows.map(({ data }) => data);
      const seed: Job[] = JSON.parse(await fs.readFile(path.join(process.cwd(), "config/jobs.seed.json"), "utf8"));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const job of seed) {
          await client.query(
            "INSERT INTO jobs (id, active, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
            [job.id, job.active, job],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      const seeded = await pool.query<{ data: Job }>("SELECT data FROM jobs ORDER BY id");
      return seeded.rows.map(({ data }) => data);
    }
    return readJobs();
  },
  async saveJob(job: Job) {
    if (config.databaseUrl) {
      await getDatabasePool().query(
        "INSERT INTO jobs (id, active, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, data = EXCLUDED.data",
        [job.id, job.active, job],
      );
      return job;
    }
    await readJobs(); // make sure the seed exists first
    return update<Job[], Job>(JOBS, [], (jobs) => {
      const i = jobs.findIndex((j) => j.id === job.id);
      if (i === -1) jobs.push(job);
      else jobs[i] = job;
      return job;
    });
  },
};
