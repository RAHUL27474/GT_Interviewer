// End-to-end server flow with the JSON store in a temp folder and the mock AI (no network, no keys).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { HttpError } from "../lib/http";
import type { Candidate } from "../lib/types";

let dir = "";
let store: typeof import("../lib/store").store;
let lib: typeof import("../lib/candidates");

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "interviewer-test-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    AI_PROVIDER: "mock",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
    HF_TOKEN: "",
    SPEECH_TO_TEXT: "off",
    DATABASE_URL: "",
    S3_BUCKET: "",
    SMTP_HOST: "",
    LOG_LEVEL: "error",
  });
  // Imported after the environment is set: these modules read it once at load.
  store = (await import("../lib/store")).store;
  lib = await import("../lib/candidates");
});
after(() => fs.rm(dir, { recursive: true, force: true }));

function candidate(id: string, status: Candidate["status"] = "ready"): Candidate {
  return {
    id,
    createdAt: new Date().toISOString(),
    fullName: "Test Candidate",
    email: `${id}@example.com`,
    phone: "+91 9000000000",
    jobId: "job-1",
    totalExperience: 3,
    currentLocation: "Delhi",
    linkedin: "",
    currentCTC: 5,
    expectedCTC: 6,
    joiningCategory: "immediate",
    jobTitle: "Advisor",
    jobSnapshot: { title: "Advisor", description: "Help customers", salaryMin: 6, salaryMax: 10 },
    resume: { fileName: "cv.txt", storedAs: `${id}.txt` },
    status,
    questions: [1, 2, 3].map((n) => ({ question: `Q${n}?`, focus: "f", based_on: "job_description", expected_points: ["p"] })),
    answers: [],
    proctoring: { events: [] },
  };
}

test("only the current question is revealed", async () => {
  await store.addCandidate(candidate("c1"));
  const state = lib.interviewState((await store.getCandidate("c1"))!);
  assert.deepEqual(state.nextQuestion, { index: 0, text: "Q1?" });
  assert.equal(state.total, 3);
  assert.equal(state.serverTranscription, false);
  assert.equal(await store.hasApplied("c1@example.com", "job-1"), true);
});

test("answers need the live session", async () => {
  const c = candidate("c2", "in_progress");
  c.sessionId = "right";
  assert.throws(() => lib.assertActiveSession(c, "wrong"), HttpError);
  lib.assertActiveSession(c, "right");
  assert.ok(c.lastSeenAt);
});

test("an interrupted interview is graded with unanswered questions at 0", async () => {
  const c = candidate("c3", "in_progress");
  c.sessionId = "s";
  c.answers.push({ transcript: "An answer", timeTakenSec: 60, submittedAt: new Date().toISOString(), video: null, snapshots: [] });
  await store.addCandidate(c);

  assert.equal(await lib.interruptInterview("c3", "Closed the tab"), true);
  assert.equal(await lib.interruptInterview("c3", "again"), false);
  await lib.runEvaluation("c3");

  const done = (await store.getCandidate("c3"))!;
  assert.equal(done.status, "completed");
  assert.equal(done.interruption?.answeredCount, 1);
  assert.equal(done.evaluation?.evaluations.length, 3);
  assert.equal(done.evaluation?.evaluations[1].score, 0);
  assert.equal(done.evaluation?.evaluations[2].score, 0);
  assert.ok(done.scores);
  assert.equal(done.sessionId, undefined);
});

test("stale interviews are swept and graded", async () => {
  const c = candidate("c4", "in_progress");
  c.lastSeenAt = new Date(Date.now() - 10 * 60_000).toISOString();
  await store.addCandidate(c);
  await lib.sweepStaleInterviews();
  const swept = (await store.getCandidate("c4"))!;
  assert.equal(swept.status, "completed");
  assert.match(swept.interruption!.reason, /Connection lost/);
});

test("deleting a candidate removes the record", async () => {
  assert.equal(await store.deleteCandidate("c1"), true);
  assert.equal(await store.getCandidate("c1"), null);
  assert.equal(await store.deleteCandidate("c1"), false);
});
