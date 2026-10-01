// The careers-site pipeline end to end, with Gmail and the AI simulated: apply -> confirmation email with Application
// ID and tracking link -> AI screening -> decision email after the delay -> tracker shows each stage.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Candidate, Job } from "../lib/types";

let dir = "";
let store: typeof import("../lib/store").store;
let apps: typeof import("../lib/applications");
let access: typeof import("../lib/access");
let tracker: typeof import("../lib/tracker");

const realFetch = globalThis.fetch;
const sentMail: string[] = [];

function fakeGoogle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const json = (data: unknown) => Promise.resolve(Response.json(data));
  if (url === "https://oauth2.googleapis.com/token") {
    return json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.send" });
  }
  if (url.startsWith("https://openidconnect.googleapis.com/")) return json({ email: "careers@example.com" });
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
    // Undo quoted-printable line wrapping so long links can be matched.
    const raw = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString("utf8");
    sentMail.push(raw.replace(/=\r?\n/g, "").replace(/=3D/g, "="));
    return json({ id: "m1" });
  }
  throw new Error(`Unexpected request in test: ${url}`);
}

const job: Job = {
  id: "seo-manager",
  title: "SEO Manager",
  location: "Delhi",
  description: "ABOUT THE ROLE\n\nGrow organic traffic.",
  salaryMin: 6,
  salaryMax: 12,
  active: true,
  screening: { passMark: 60, minExperience: 3 },
};

function applicationForm(fields: Record<string, string>) {
  const f = new FormData();
  const all = {
    fullName: "Asha K", email: "asha@example.com", phone: "+91 98765 43210", totalExperience: "4", currentLocation: "Delhi",
    currentCTC: "6", expectedCTC: "9", joiningCategory: "30_days", ...fields,
  };
  for (const [k, v] of Object.entries(all)) f.set(k, v);
  return f;
}
const pdf = () => new File(["%PDF-1.4 SEO manager, 4 years, technical audits"], "resume.pdf", { type: "application/pdf" });
const mailTo = (to: string) => sentMail.filter((m) => m.includes(`To: ${to}`));
const subjectOf = (m: string) => m.match(/^Subject: (.*)$/m)?.[1] ?? "";

async function apply(fields: Record<string, string> = {}) {
  const profile = apps.parseApplication(applicationForm(fields), job.id);
  const c = await apps.submitApplication(job, profile, await apps.readResume(pdf()));
  await access.sendApplicationReceived(c);
  return c;
}
/** Moves an application's clock back, as if it was submitted `minutes` ago. */
async function age(id: string, minutes: number) {
  await store.updateCandidate(id, (c) => {
    const t = Date.now() - minutes * 60_000;
    c.createdAt = new Date(t).toISOString();
    c.access!.inviteAt = new Date(t + 120 * 60_000).toISOString();
  });
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "careers-"));
  Object.assign(process.env, {
    DATA_DIR: dir, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", HF_TOKEN: "", DATABASE_URL: "",
    S3_BUCKET: "", SMTP_HOST: "", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", APP_URL: "https://jobs.example.com",
    DECISION_DELAY_MINUTES: "120", INTERVIEW_ACCESS_HOURS: "24", SESSION_SECRET: "test-secret", COMPANY_NAME: "Galaxy Toyota",
    LOG_LEVEL: "error",
  });
  globalThis.fetch = fakeGoogle as typeof fetch;
  store = (await import("../lib/store")).store;
  apps = await import("../lib/applications");
  access = await import("../lib/access");
  tracker = await import("../lib/tracker");
  await (await import("../lib/google")).finishConnect("code", "http://localhost:3000", "hr@example.com");
  await store.saveJob(job);
});
after(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(dir, { recursive: true, force: true });
});

let asha: Candidate;

test("applying saves the application and emails the Application ID and tracking link", async () => {
  asha = await apply();
  assert.match(asha.applicationRef!, /^GA-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(asha.screening!.decision, "pending");
  assert.equal(asha.source, "website");
  assert.ok(asha.resume?.storedAs.endsWith(".pdf"));

  const [mail] = mailTo("asha@example.com");
  assert.match(subjectOf(mail), /^Application received: SEO Manager/);
  assert.ok(mail.includes(asha.applicationRef!));
  assert.ok(mail.includes(`https://jobs.example.com/track/${asha.trackToken}`));
  assert.match(tracker.trackerView((await store.getCandidate(asha.id))!).headline, /being reviewed/);
});

test("the same email can't apply twice for one job", async () => {
  await assert.rejects(apply(), /already applied/);
});

test("AI screening decides, but nothing is sent or shown until the delay is up", async () => {
  await apps.screenApplication(asha.id);
  const c = (await store.getCandidate(asha.id))!;
  assert.equal(c.screening!.decision, "selected");
  assert.ok(c.questions.length > 0);
  assert.ok(c.screening!.receivedEmailedAt, "receipt time kept through screening");

  await access.sendDueInvites();
  assert.equal(mailTo("asha@example.com").length, 1, "no decision email yet");
  assert.match(tracker.trackerView(c).headline, /being reviewed/);
});

test("after the delay the login email goes out, and the tracker shows the interview", async () => {
  await age(asha.id, 130);
  await access.sendDueInvites();
  const login = mailTo("asha@example.com")[1];
  assert.match(subjectOf(login), /^You're shortlisted/);
  assert.ok(login.includes("https://jobs.example.com/login"));
  const v = tracker.trackerView((await store.getCandidate(asha.id))!);
  assert.match(v.headline, /shortlisted/);
  assert.ok(v.interview?.startBy);
});

test("an applicant below the experience minimum gets the rejection after the delay", async () => {
  const neha = await apply({ email: "neha@example.com", fullName: "Neha P", totalExperience: "1" });
  await apps.screenApplication(neha.id);
  assert.equal((await store.getCandidate(neha.id))!.status, "rejected");
  await age(neha.id, 130);
  await access.sendDueInvites();
  const mails = mailTo("neha@example.com");
  assert.match(subjectOf(mails.at(-1)!), /^Your application for SEO Manager/);
  assert.match(tracker.trackerView((await store.getCandidate(neha.id))!).headline, /wasn't selected/);
});

test("applications are found by tracking link or by email + Application ID", async () => {
  assert.equal((await apps.findByTrackToken(asha.trackToken!))?.id, asha.id);
  assert.equal(await apps.findByTrackToken("x".repeat(32)), null);
  assert.equal((await apps.findByRef("ASHA@example.com", asha.applicationRef!.toLowerCase()))?.id, asha.id);
  assert.equal(await apps.findByRef("someone@example.com", asha.applicationRef!), null);
});

test("a screening that was cut short is picked up by the retry sweep", async () => {
  const ravi = await apply({ email: "ravi@example.com", fullName: "Ravi S" });
  await apps.screenPendingApplications();
  assert.equal((await store.getCandidate(ravi.id))!.screening!.decision, "pending", "fresh ones are left to the first attempt");
  await age(ravi.id, 5);
  await apps.screenPendingApplications();
  assert.equal((await store.getCandidate(ravi.id))!.screening!.decision, "selected");
});

test("closed jobs don't take applications", async () => {
  const profile = apps.parseApplication(applicationForm({ email: "late@example.com" }), job.id);
  await assert.rejects(apps.submitApplication({ ...job, active: false }, profile, await apps.readResume(pdf())), /no longer open/);
});
