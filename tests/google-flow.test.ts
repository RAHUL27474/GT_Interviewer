// The whole Google Forms pipeline with Google's servers faked: connect the account, a response arrives, it becomes a
// candidate, the login email goes out through Gmail after the delay, the candidate logs in, and the window expires.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Job } from "../lib/types";

let dir = "";
let store: typeof import("../lib/store").store;
let intake: typeof import("../lib/intake");
let access: typeof import("../lib/access");
let google: typeof import("../lib/google");

const realFetch = globalThis.fetch;
const sentMail: string[] = [];
let responses: object[] = [];

function fakeGoogle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const json = (data: unknown) => Promise.resolve(Response.json(data));
  if (url === "https://oauth2.googleapis.com/token") {
    return json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: google.GOOGLE_SCOPES.join(" ") });
  }
  if (url.startsWith("https://openidconnect.googleapis.com/")) return json({ email: "careers@example.com" });
  if (url.startsWith("https://forms.googleapis.com/v1/forms/FORM1/responses")) return json({ responses });
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
    sentMail.push(Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString("utf8"));
    return json({ id: "m1" });
  }
  throw new Error(`Unexpected request in test: ${url}`);
}

const job: Job = {
  id: "advisor",
  title: "Service Advisor",
  location: "Delhi",
  description: "Handle customers",
  salaryMin: 4,
  salaryMax: 7,
  active: true,
  googleForm: {
    formId: "FORM1",
    responderUri: "https://docs.google.com/forms/d/e/x/viewform",
    owner: "careers@example.com",
    createdAt: "2026-01-01T00:00:00Z",
    emailFromSettings: true,
    questionIds: { fullName: "q1", phone: "q2", expectedCTC: "q3", joiningCategory: "q4", resumeUrl: "q5" },
    syncedUntil: "2026-01-01T00:00:00Z",
  },
};
const answer = (value: string) => ({ textAnswers: { answers: [{ value }] } });

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "interviewer-google-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    AI_PROVIDER: "mock",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
    HF_TOKEN: "",
    DATABASE_URL: "",
    S3_BUCKET: "",
    SMTP_HOST: "",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "secret",
    APP_URL: "https://jobs.example.com",
    INVITE_DELAY_MINUTES: "30",
    INTERVIEW_ACCESS_HOURS: "24",
    SESSION_SECRET: "test-secret",
    LOG_LEVEL: "error",
  });
  globalThis.fetch = fakeGoogle as typeof fetch;
  store = (await import("../lib/store")).store;
  intake = await import("../lib/intake");
  access = await import("../lib/access");
  google = await import("../lib/google");
});
after(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(dir, { recursive: true, force: true });
});

test("connecting stores the account with an encrypted token", async () => {
  assert.equal(await google.finishConnect("code", "http://localhost:3000", "manager@example.com"), "careers@example.com");
  const conn = await google.googleConnection();
  assert.equal(conn?.email, "careers@example.com");
  assert.equal(conn?.canSendMail, true);
  const raw = await fs.readFile(path.join(dir, "settings.json"), "utf8");
  assert.ok(!raw.includes('"rt"'), "refresh token must not be stored in plain text");
});

test("a form response becomes a candidate with a scheduled login email", async () => {
  await store.saveJob(job);
  const submitted = new Date(Date.now() - 40 * 60_000).toISOString(); // 40 min ago: the email is already due
  responses = [
    {
      responseId: "R1",
      lastSubmittedTime: submitted,
      respondentEmail: "asha@example.com",
      answers: { q1: answer("Asha K"), q2: answer("+91 98765 43210"), q3: answer("6"), q4: answer("Immediate") },
    },
  ];
  await intake.syncAllForms();

  const [c] = await store.listCandidatesByEmail("asha@example.com");
  assert.ok(c, "candidate created");
  assert.equal(c.source, "google_form");
  assert.equal(c.status, "ready");
  assert.equal(c.questions.length > 0, true);
  assert.equal(c.resume, null);
  assert.match(c.resumeProblem!, /No resume link/);
  assert.equal(Date.parse(c.access!.inviteAt), Date.parse(submitted) + 30 * 60_000);

  const saved = (await store.listJobs()).find((j) => j.id === job.id)!;
  assert.equal(saved.googleForm!.syncedUntil, submitted);
  assert.equal(saved.googleForm!.lastError, undefined);

  // Reading the same response again doesn't add it twice.
  await store.saveJob({ ...saved, googleForm: { ...saved.googleForm!, syncedUntil: "2026-01-01T00:00:00Z" } });
  await intake.syncAllForms();
  assert.equal((await store.listCandidatesByEmail("asha@example.com")).length, 1);
});

test("the due login email is sent through Gmail and the password works for 24 hours", async () => {
  await access.sendDueInvites();
  assert.equal(sentMail.length, 1);
  const mail = sentMail[0];
  assert.match(mail, /To: asha@example\.com/);
  const password = mail.match(/Password: ([A-Za-z0-9]{10})/)?.[1];
  assert.ok(password, "password in the email");

  let [c] = await store.listCandidatesByEmail("asha@example.com");
  assert.equal(c.access!.delivery, "email");
  const window = Date.parse(c.access!.expiresAt!) - Date.parse(c.access!.invitedAt!);
  assert.equal(window, 24 * 3_600_000);

  // Sent once only.
  await access.sendDueInvites();
  assert.equal(sentMail.length, 1);

  assert.equal((await access.candidateLogin("ASHA@example.com", password)).id, c.id);
  await assert.rejects(access.candidateLogin("asha@example.com", "wrong-pass"), /Wrong email or password/);

  // After the window, the same password is refused.
  await store.updateCandidate(c.id, (cand) => {
    cand.access!.expiresAt = new Date(Date.now() - 1000).toISOString();
  });
  await assert.rejects(access.candidateLogin("asha@example.com", password), /time to start this interview ended/);
  [c] = await store.listCandidatesByEmail("asha@example.com");
  assert.equal(access.inviteState(c), "expired");
});

test("HR can issue new login details, which replace the old password", async () => {
  const [c] = await store.listCandidatesByEmail("asha@example.com");
  const result = await access.issueLoginDetails(c.id, { showOnFailure: true });
  assert.deepEqual(result, { emailed: true });
  const updated = (await store.getCandidate(c.id))!;
  assert.equal(access.inviteState(updated), "sent");
  assert.equal(updated.access!.version, 2);
  const newPassword = sentMail.at(-1)!.match(/Password: ([A-Za-z0-9]{10})/)![1];
  assert.equal((await access.candidateLogin("asha@example.com", newPassword)).id, c.id);
});
