// PostgreSQL database (used when DATABASE_URL is set). Each record is one row: a few columns used for lookups,
// plus the full record as JSONB. Updates lock the row, so several app servers can safely share one database.
import postgres from "postgres";
import type { Candidate, Job, StaffUser } from "../types";
import { type Db, seedJobs, upgrade } from "./shared";

type Sql = postgres.Sql | postgres.TransactionSql;
const json = (value: unknown) => value as postgres.JSONValue;

const g = globalThis as unknown as { __pg?: postgres.Sql; __pgReady?: Promise<void> };

function connect(url: string) {
  // One pool per process (kept on globalThis so dev hot-reloads don't open new ones).
  g.__pg ??= postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE || 10), onnotice: () => {} });
  const sql = g.__pg;
  // Creates the tables on first use; the advisory lock stops two servers doing it at once.
  g.__pgReady ??= sql
    .begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(782311)`;
      await tx`
        CREATE TABLE IF NOT EXISTS candidates (
          id text PRIMARY KEY,
          email text NOT NULL,
          job_id text NOT NULL,
          status text NOT NULL,
          created_at timestamptz NOT NULL,
          data jsonb NOT NULL
        )`;
      await tx`CREATE INDEX IF NOT EXISTS candidates_status_idx ON candidates (status)`;
      await tx`CREATE INDEX IF NOT EXISTS candidates_email_job_idx ON candidates (email, job_id)`;
      await tx`
        CREATE TABLE IF NOT EXISTS jobs (
          id text PRIMARY KEY,
          position bigserial,
          data jsonb NOT NULL
        )`;
      await tx`
        CREATE TABLE IF NOT EXISTS staff_users (
          id text PRIMARY KEY,
          email text NOT NULL UNIQUE,
          position bigserial,
          data jsonb NOT NULL
        )`;
      await tx`
        CREATE TABLE IF NOT EXISTS settings (
          key text PRIMARY KEY,
          data jsonb NOT NULL
        )`;
      const [{ count }] = await tx`SELECT count(*)::int AS count FROM jobs`;
      if (count === 0) for (const job of await seedJobs()) await upsertJob(tx, job);
    })
    .then(() => undefined)
    .catch((err) => {
      g.__pgReady = undefined; // retry on the next request
      throw err;
    });
  return { sql, ready: g.__pgReady };
}

async function upsertJob(sql: Sql, job: Job) {
  await sql`
    INSERT INTO jobs (id, data) VALUES (${job.id}, ${sql.json(json(job))})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
}

async function upsertUser(sql: Sql, user: StaffUser) {
  await sql`
    INSERT INTO staff_users (id, email, data) VALUES (${user.id}, ${user.email}, ${sql.json(json(user))})
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data`;
}

export function postgresDb(url: string): Db {
  const db = async () => {
    const { sql, ready } = connect(url);
    await ready;
    return sql;
  };
  const candidates = (rows: postgres.RowList<postgres.Row[]>) => rows.map((r) => upgrade(r.data as Candidate));

  return {
    async listCandidates() {
      const sql = await db();
      return candidates(await sql`SELECT data FROM candidates ORDER BY created_at`);
    },
    async listCandidatesByStatus(...statuses) {
      const sql = await db();
      return candidates(await sql`SELECT data FROM candidates WHERE status IN ${sql(statuses)} ORDER BY created_at`);
    },
    async getCandidate(id) {
      const sql = await db();
      return candidates(await sql`SELECT data FROM candidates WHERE id = ${id}`)[0] ?? null;
    },
    async listCandidatesByEmail(email) {
      const sql = await db();
      return candidates(await sql`SELECT data FROM candidates WHERE email = ${email} ORDER BY created_at`);
    },
    async hasApplied(email, jobId) {
      const sql = await db();
      return (await sql`SELECT 1 FROM candidates WHERE email = ${email} AND job_id = ${jobId} LIMIT 1`).length > 0;
    },
    async addCandidate(c) {
      const sql = await db();
      await sql`
        INSERT INTO candidates (id, email, job_id, status, created_at, data)
        VALUES (${c.id}, ${c.email}, ${c.jobId}, ${c.status}, ${c.createdAt}, ${sql.json(json(c))})`;
    },
    async updateCandidate(id, fn) {
      const sql = await db();
      return sql.begin(async (tx) => {
        const [row] = await tx`SELECT data FROM candidates WHERE id = ${id} FOR UPDATE`;
        if (!row) return null;
        const c = upgrade(row.data as Candidate);
        await fn(c);
        await tx`
          UPDATE candidates SET email = ${c.email}, job_id = ${c.jobId}, status = ${c.status}, data = ${tx.json(json(c))}
          WHERE id = ${id}`;
        return c;
      });
    },
    async deleteCandidate(id) {
      const sql = await db();
      return candidates(await sql`DELETE FROM candidates WHERE id = ${id} RETURNING data`)[0] ?? null;
    },

    async listUsers() {
      const sql = await db();
      return (await sql`SELECT data FROM staff_users ORDER BY position`).map((r) => r.data as StaffUser);
    },
    async saveUser(user) {
      await upsertUser(await db(), user);
      return user;
    },
    async updateUsers(fn) {
      const sql = await db();
      return sql.begin(async (tx) => {
        await tx`LOCK TABLE staff_users IN EXCLUSIVE MODE`;
        const users = (await tx`SELECT data FROM staff_users ORDER BY position`).map((r) => r.data as StaffUser);
        const before = users.map((u) => u.id);
        const result = await fn(users);
        const kept = new Set(users.map((u) => u.id));
        const removed = before.filter((id) => !kept.has(id));
        if (removed.length) await tx`DELETE FROM staff_users WHERE id IN ${tx(removed)}`;
        for (const u of users) await upsertUser(tx, u);
        return result;
      }) as Promise<Awaited<ReturnType<typeof fn>>>;
    },

    async listJobs() {
      const sql = await db();
      return (await sql`SELECT data FROM jobs ORDER BY position`).map((r) => r.data as Job);
    },
    async saveJob(job) {
      await upsertJob(await db(), job);
      return job;
    },
    async deleteJob(id) {
      const sql = await db();
      return (await sql`DELETE FROM jobs WHERE id = ${id} RETURNING id`).length > 0;
    },

    async getSetting<T>(key: string) {
      const sql = await db();
      const [row] = await sql`SELECT data FROM settings WHERE key = ${key}`;
      return row ? (row.data as T) : null;
    },
    async setSetting(key, value) {
      const sql = await db();
      if (value === null) await sql`DELETE FROM settings WHERE key = ${key}`;
      else {
        await sql`
          INSERT INTO settings (key, data) VALUES (${key}, ${sql.json(json(value))})
          ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`;
      }
    },
  };
}
