// Records (candidates, jobs, staff): PostgreSQL when DATABASE_URL is set, otherwise JSON files in DATA_DIR
// (local development). Files (resumes, videos, snapshots) live in lib/files.ts.
import { jsonDb } from "./db/json";
import { postgresDb } from "./db/postgres";
import type { Db } from "./db/shared";
import { files, mediaPrefix, resumeKey } from "./files";

const url = process.env.DATABASE_URL?.trim();
const db: Db = url ? postgresDb(url) : jsonDb;
export const databaseLabel = url ? "PostgreSQL" : "JSON files (local development)";

export const store = {
  ...db,
  /** Deletes a candidate record plus their resume and all interview media. */
  async deleteCandidate(id: string) {
    const removed = await db.deleteCandidate(id);
    if (!removed) return false;
    await files.remove([resumeKey(removed.resume.storedAs)]);
    await files.removePrefix(mediaPrefix(id));
    return true;
  },
};
