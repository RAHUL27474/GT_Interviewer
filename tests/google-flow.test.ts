// The whole Google Forms pipeline with Google's servers faked: connect the account, applications arrive and are
// screened, the three emails go out (received now; shortlisted-with-login or rejection after the delay), the
// candidate logs in, the window expires, and HR overrides decisions.
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
  // A public resume link (an IP address, so the test needs no DNS).
  if (url === "https://8.8.8.8/cv.txt") {
    return Promise.resolve(new Response("Service advisor, 3 years at a Toyota dealership.", { headers: { "Content-Type": "text/plain" } }));
  }
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
  screening: { passMark: 60, minExperience: 2 },
  googleForm: {
    formId: "FORM1",
    responderUri: "https://docs.google.com/forms/d/e/x/viewform",
    owner: "careers@example.com",
    createdAt: "2026-01-01T00:00:00Z",
    emailFromSettings: true,
    questionIds: { fullName: "q1", phone: "q2", expectedCTC: "q3", joiningCategory: "q4", resumeUrl: "q5", totalExperience: "q6" },
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
    DECISION_DELAY_MINUTES: "120",
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

const mailTo = (to: string) => sentMail.filter((m) => m.includes(`To: ${to}`));
const subjectOf = (m: string) => m.match(/^Subject: (.*)$/m)?.[1] ?? "";
const passwordIn = (m: string) => m.match(/Password: ([A-Za-z0-9]{10})/)?.[1];
const byEmail = async (email: string) => (await store.listCandidatesByEmail(email))[0];

function application(id: string, email: string, name: string, years: string, resume: string, minutesAgo: number) {
  return {
    responseId: id,
    lastSubmittedTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    respondentEmail: email,
    answers: {
      q1: answer(name),
      q2: answer("+91 98765 43210"),
      q3: answer("6"),
      q4: answer("Immediate"),
      q5: answer(resume),
      q6: answer(years),
    },
  };
}

test("applications are screened and each applicant is told straight away that it arrived", async () => {
  await store.saveJob(job);
  responses = [
    // Readable resume, rated 70 by the mock AI: shortlisted. Applied 3 hours ago, so the decision email is due.
    application("R1", "asha@example.com", "Asha K", "3", "https://8.8.8.8/cv.txt", 180),
    // No readable resume: waits for HR.
    application("R2", "ravi@example.com", "Ravi S", "5", "", 180),
    // Below the job's 2-year minimum: not selected.
    application("R3", "neha@example.com", "Neha P", "1", "https://8.8.8.8/cv.txt", 180),
  ];
  await intake.syncAllForms();

  const asha = await byEmail("asha@example.com");
  assert.equal(asha.status, "ready");
  assert.equal(asha.screening!.decision, "selected");
  assert.equal(asha.screening!.score, 70);
  assert.ok(asha.questions.length > 0, "shortlisted applicants get questions");
  assert.equal(asha.resume?.fileName, "resume.txt");
  assert.equal(Date.parse(asha.access!.inviteAt) - Date.parse(asha.createdAt), 120 * 60_000);

  const ravi = await byEmail("ravi@example.com");
  assert.equal(ravi.status, "ready");
  assert.equal(ravi.screening!.decision, "review");
  assert.equal(access.inviteState(ravi), "review");
  assert.equal(ravi.questions.length, 0);

  const neha = await byEmail("neha@example.com");
  assert.equal(neha.status, "rejected");
  assert.match(neha.screening!.reasons[0], /needs at least 2/);
  assert.equal(neha.questions.length, 0);

  // Email 1 of 3: "application received", to all three, straight away.
  for (const who of ["asha", "ravi", "neha"]) {
    const mails = mailTo(`${who}@example.com`);
    assert.equal(mails.length, 1, who);
    assert.match(subjectOf(mails[0]), /^Application received: Service Advisor/);
    assert.ok((await byEmail(`${who}@example.com`)).screening!.receivedEmailedAt);
  }

  // Reading the same responses again adds nobody twice.
  const saved = (await store.listJobs()).find((j) => j.id === job.id)!;
  await store.saveJob({ ...saved, googleForm: { ...saved.googleForm!, syncedUntil: "2026-01-01T00:00:00Z" } });
  await intake.syncAllForms();
  assert.equal((await store.listCandidatesByEmail("asha@example.com")).length, 1);
  assert.equal(sentMail.length, 3);
});

test("after the delay: shortlisted get their login, rejected get the rejection, review gets nothing", async () => {
  await access.sendDueInvites();

  const ashaLogin = mailTo("asha@example.com")[1];
  assert.ok(ashaLogin, "login email sent");
  assert.match(subjectOf(ashaLogin), /^You're shortlisted: video interview for Service Advisor/);
  const password = passwordIn(ashaLogin);
  assert.ok(password, "password in the email");

  const nehaMails = mailTo("neha@example.com");
  assert.equal(nehaMails.length, 2);
  assert.match(subjectOf(nehaMails[1]), /^Your application for Service Advisor/);
  assert.match(nehaMails[1], /won't be taking it forward/);
  assert.doesNotMatch(nehaMails[1], /experience|pass mark|rated/i, "screening reasons stay with HR");
  assert.ok((await byEmail("neha@example.com")).screening!.rejectionEmailedAt);

  assert.equal(mailTo("ravi@example.com").length, 1);

  // Nothing is sent twice.
  await access.sendDueInvites();
  assert.equal(sentMail.length, 5);

  const asha = await byEmail("asha@example.com");
  assert.equal(Date.parse(asha.access!.expiresAt!) - Date.parse(asha.access!.invitedAt!), 24 * 3_600_000);
  assert.equal((await access.candidateLogin("ASHA@example.com", password)).id, asha.id);
  await assert.rejects(access.candidateLogin("asha@example.com", "wrong-pass"), /Wrong email or password/);
});

test("the login stops working after 24 hours, and HR can issue a new one", async () => {
  const asha = await byEmail("asha@example.com");
  const oldPassword = passwordIn(mailTo("asha@example.com")[1])!;
  await store.updateCandidate(asha.id, (c) => {
    c.access!.expiresAt = new Date(Date.now() - 1000).toISOString();
  });
  await assert.rejects(access.candidateLogin("asha@example.com", oldPassword), /time to start this interview ended/);
  assert.equal(access.inviteState((await store.getCandidate(asha.id))!), "expired");

  assert.deepEqual(await access.issueLoginDetails(asha.id, { showOnFailure: true }), { emailed: true });
  const newPassword = passwordIn(mailTo("asha@example.com").at(-1)!)!;
  assert.equal((await access.candidateLogin("asha@example.com", newPassword)).id, asha.id);
});

test("HR shortlists the applicant under review: questions are written and the login goes out", async () => {
  const ravi = await byEmail("ravi@example.com");
  const result = await access.decideByHr(ravi.id, "selected", "hr@example.com");
  assert.equal(result.emailed, true);
  const updated = (await store.getCandidate(ravi.id))!;
  assert.equal(updated.screening!.decision, "selected");
  assert.equal(updated.screening!.decidedBy, "hr@example.com");
  assert.ok(updated.questions.length > 0);
  const login = mailTo("ravi@example.com").at(-1)!;
  assert.match(subjectOf(login), /^You're shortlisted/);
  assert.equal((await access.candidateLogin("ravi@example.com", passwordIn(login)!)).id, ravi.id);
});

test("HR rejects a shortlisted applicant: their login stops working and the rejection goes out", async () => {
  const asha = await byEmail("asha@example.com");
  const password = passwordIn(mailTo("asha@example.com").at(-1)!)!;
  const result = await access.decideByHr(asha.id, "rejected", "hr@example.com");
  assert.equal(result.rejectionSent, true);
  assert.equal((await store.getCandidate(asha.id))!.status, "rejected");
  assert.match(subjectOf(mailTo("asha@example.com").at(-1)!), /^Your application for Service Advisor/);
  await assert.rejects(access.candidateLogin("asha@example.com", password), /Wrong email or password/);
});
