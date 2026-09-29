// Copies everything saved locally (data/*.json and data/resumes, data/videos) into the database and bucket
// configured in .env. Safe to run more than once: existing candidates are skipped and files are re-uploaded.
//
//   npm run migrate
//
// Needs DATABASE_URL. Files are uploaded only if S3_BUCKET is set.
import fs from "node:fs/promises";
import path from "node:path";
import { jsonDb } from "../lib/db/json";
import { postgresDb } from "../lib/db/postgres";
import { files, fileStorageLabel, localFiles } from "../lib/files";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
};

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (!e.name.endsWith(".tmp")) yield full;
  }
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Set DATABASE_URL in .env first.");
  const pg = postgresDb(url);
  console.log(`From: ${localFiles.root}\nTo:   PostgreSQL, files -> ${fileStorageLabel}\n`);

  // Jobs: the database now holds exactly the local jobs (replacing the seed jobs a new database starts with).
  const jobs = await jsonDb.listJobs();
  const localJobIds = new Set(jobs.map((j) => j.id));
  for (const job of jobs) await pg.saveJob(job);
  for (const job of await pg.listJobs()) if (!localJobIds.has(job.id)) await pg.deleteJob(job.id);
  console.log(`Jobs: ${jobs.length} copied`);

  // Staff: local accounts win; a database account with the same email (e.g. auto-created on first login) is replaced.
  const users = await jsonDb.listUsers();
  await pg.updateUsers((existing) => {
    for (const u of users) {
      const i = existing.findIndex((e) => e.id === u.id || e.email === u.email);
      if (i === -1) existing.push(u);
      else existing[i] = u;
    }
  });
  console.log(`Staff accounts: ${users.length} copied`);

  // Settings: the connected Google account (its token is encrypted with SESSION_SECRET, so keep that the same).
  const googleSetting = await jsonDb.getSetting("google");
  if (googleSetting) {
    await pg.setSetting("google", googleSetting);
    console.log("Google connection copied");
  }

  let added = 0;
  let skipped = 0;
  for (const c of await jsonDb.listCandidates()) {
    if (await pg.getCandidate(c.id)) skipped++;
    else {
      await pg.addCandidate(c);
      added++;
    }
  }
  console.log(`Candidates: ${added} copied, ${skipped} already in the database`);

  if (!process.env.S3_BUCKET?.trim()) {
    console.log("\nS3_BUCKET is not set, so files stay in the local folder.");
    return;
  }
  let count = 0;
  let bytes = 0;
  for (const sub of ["resumes", "videos"]) {
    for await (const full of walk(path.join(localFiles.root, sub))) {
      const key = path.relative(localFiles.root, full).split(path.sep).join("/");
      const data = await fs.readFile(full);
      await files.put(key, data, MIME[path.extname(full).toLowerCase()]);
      count++;
      bytes += data.length;
      if (count % 20 === 0) console.log(`  ${count} files uploaded...`);
    }
  }
  console.log(`Files: ${count} uploaded (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}

main()
  .then(() => {
    console.log("\nDone. The local data folder was not changed; delete it once you've checked the app.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nMigration failed:", err);
    process.exit(1);
  });
