import fs from "node:fs/promises";
import path from "node:path";
import { getDatabasePool } from "../lib/database";
import { objectStorageEnabled, writeStoredObject } from "../lib/object-storage";
import type { Candidate, Job } from "../lib/types";

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function importMediaTree(source: string, prefix: string): Promise<number> {
  let copied = 0;
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const local = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(local);
      } else if (entry.isFile()) {
        const relative = path.relative(source, local).split(path.sep).join("/");
        await writeStoredObject(`${prefix}/${relative}`, await fs.readFile(local));
        copied += 1;
      }
    }
  }
  try {
    await walk(source);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return copied;
}

async function main() {
  const root = process.cwd();
  const pool = getDatabasePool();
  const candidates = await readJson<Record<string, Candidate>>(path.join(root, "data", "candidates.json"), {});
  const jobs = await readJson<Job[] | null>(path.join(root, "data", "jobs.json"), null)
    ?? await readJson<Job[]>(path.join(root, "config", "jobs.seed.json"), []);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const job of jobs) {
      await client.query(
        "INSERT INTO jobs (id, active, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [job.id, job.active, job],
      );
    }
    for (const candidate of Object.values(candidates)) {
      await client.query(
        "INSERT INTO candidates (id, email, job_id, status, created_at, data) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        [candidate.id, candidate.email, candidate.jobId, candidate.status, candidate.createdAt, candidate],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  let copied = 0;
  if (objectStorageEnabled) {
    copied += await importMediaTree(path.join(root, "data", "resumes"), "resumes");
    copied += await importMediaTree(path.join(root, "data", "videos"), "videos");
  }
  console.info(`Imported ${jobs.length} jobs and ${Object.keys(candidates).length} candidates.`);
  console.info(objectStorageEnabled
    ? `Copied ${copied} media files to object storage; source files were preserved.`
    : "Object storage is not configured; local media files were preserved in place.");
  await pool.end();
}

main().catch((err) => {
  console.error("JSON data import failed:", err);
  process.exitCode = 1;
});