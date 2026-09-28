/**
 * The file-backed store must survive the files people actually write.
 *
 * Regression test for a real outage. `data/candidates.json` was once written by
 * PowerShell's `Set-Content -Encoding UTF8`, which prepends a byte-order mark.
 * `JSON.parse` rejects "\uFEFF{}" outright, so that single stray byte took down
 * every route touching the store: `POST /api/register` returned a bare 500
 * ("Something went wrong. Please try again."), the interview page 500'd, and the
 * 20s `sweepStaleInterviews` loop in instrumentation.ts threw on every tick. One
 * bad write by one tool was indistinguishable from a broken application.
 *
 * The BOM carries no meaning for JSON, so `read()` drops it. These tests pin that
 * behaviour and - just as importantly - pin that genuine corruption is still
 * reported rather than swallowed along with the BOM.
 *
 * The store file is backed up and restored around every case, so a run leaves the
 * developer's candidate list exactly as it found it. When DATABASE_URL is set the
 * store reads from Postgres and the file is not consulted, so the file cases are
 * skipped rather than faked.
 *
 * Run it on its own with:
 *   node --env-file-if-exists=.env --import tsx lib/store.test.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { store } from "./store";
import type { Candidate } from "./types";
import { assert, suite } from "./test-harness";

const { test, done } = suite("store");

const CANDIDATES_FILE = path.join(process.cwd(), "data", "candidates.json");
const BOM = "\uFEFF";

/** A record with every field the store and `upgrade()` read. */
function fixtureCandidate(id: string): Candidate {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    fullName: "Alex Mercer",
    email: `${id}@selftest.invalid`,
    phone: "+1 555 0192834",
    jobId: "selftest",
    jobTitle: "Backend Engineer",
    jobSnapshot: {
      title: "Backend Engineer",
      description: "Python, Django, PostgreSQL, AWS, Docker.",
      salaryMin: null,
      salaryMax: null,
    },
    totalExperience: 4,
    currentLocation: "San Francisco, CA",
    linkedin: "linkedin.com/in/alexmercer",
    currentCTC: 0,
    expectedCTC: 1200000,
    joiningCategory: "30_days",
    resume: { fileName: "resume.txt", storedAs: `${id}.txt` },
    profileComplete: true,
    status: "awaiting_screening",
    questions: [],
    answers: [],
    proctoring: { events: [] },
  };
}

/** Replace candidates.json for the duration of `fn`, then put it back. */
async function withStoreFile<T>(contents: string, fn: () => Promise<T>): Promise<T> {
  const backup = await fs.readFile(CANDIDATES_FILE, "utf8").catch(() => null);
  try {
    await fs.mkdir(path.dirname(CANDIDATES_FILE), { recursive: true });
    await fs.writeFile(CANDIDATES_FILE, contents, "utf8");
    return await fn();
  } finally {
    if (backup === null) await fs.rm(CANDIDATES_FILE, { force: true });
    else await fs.writeFile(CANDIDATES_FILE, backup, "utf8");
  }
}

async function main(): Promise<void> {
  if (config.databaseUrl) {
    console.log("  skip  DATABASE_URL is set; the store reads Postgres, so the data files are not consulted");
    done();
    return;
  }

  console.log("\n1. A byte-order mark is not fatal");
  await test("listCandidates reads a BOM-prefixed file", async () => {
    const id = "bom-list";
    const body = JSON.stringify({ [id]: fixtureCandidate(id) }, null, 2);
    await withStoreFile(BOM + body, async () => {
      const all = await store.listCandidates();
      assert.equal(all.length, 1, "expected the BOM-prefixed file to be read");
      assert.equal(all[0].id, id);
      assert.equal(all[0].fullName, "Alex Mercer");
    });
  });

  await test("getCandidate reads a BOM-prefixed file", async () => {
    const id = "bom-get";
    const body = JSON.stringify({ [id]: fixtureCandidate(id) }, null, 2);
    await withStoreFile(BOM + body, async () => {
      const found = await store.getCandidate(id);
      assert.ok(found, "expected the BOM-prefixed record to be found");
      assert.equal(found.id, id);
      assert.equal(found.jobTitle, "Backend Engineer");
    });
  });

  await test("a BOM on an empty store is not an error", async () => {
    // The exact shape that broke the app: a BOM followed by "{}".
    await withStoreFile(`${BOM}{}`, async () => {
      assert.deepEqual(await store.listCandidates(), []);
    });
  });

  console.log("\n2. A write after a BOM leaves the file re-readable");
  await test("the record survives a round trip through disk", async () => {
    const id = "bom-write";
    await withStoreFile(`${BOM}{}`, async () => {
      await store.addCandidate(fixtureCandidate(id));
      // Parses on its own terms: whatever we put on disk must be clean JSON.
      const parsed = JSON.parse(await fs.readFile(CANDIDATES_FILE, "utf8"));
      assert.equal(parsed[id].id, id, "the new record should be readable from disk");
      // The assertion that actually matters: the write has to leave the file in
      // a state the next read can parse.
      assert.equal((await store.getCandidate(id))?.id, id);
    });
  });

  console.log("\n3. The BOM tolerance is narrow");
  await test("a missing file still falls back to empty", async () => {
    const backup = await fs.readFile(CANDIDATES_FILE, "utf8").catch(() => null);
    try {
      await fs.rm(CANDIDATES_FILE, { force: true });
      assert.deepEqual(await store.listCandidates(), []);
      assert.equal(await store.getCandidate("anything"), null);
    } finally {
      if (backup !== null) await fs.writeFile(CANDIDATES_FILE, backup, "utf8");
    }
  });

  await test("genuinely corrupt JSON still throws", async () => {
    // The guard on the guard. Tolerating a BOM must not turn a truncated or
    // mangled file into an empty candidate list, which would look like every
    // candidate had vanished and quietly invite a fresh round of applications.
    await withStoreFile("{ this is not json", async () => {
      await assert.rejects(() => store.listCandidates(), /JSON/i);
    });
  });

  await test("a BOM in front of corrupt JSON still throws", async () => {
    await withStoreFile(`${BOM}{ this is not json`, async () => {
      await assert.rejects(() => store.listCandidates(), /JSON/i);
    });
  });

  done();
}

main().catch((error) => {
  console.error("\nTest run crashed:", error);
  process.exit(1);
});
