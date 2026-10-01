import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePassword } from "../lib/access";
import { accessExpired, inviteState } from "../lib/invite-state";
import type { CandidateAccess } from "../lib/types";

test("passwords avoid look-alike characters and differ each time", () => {
  const p = generatePassword();
  assert.equal(p.length, 10);
  assert.doesNotMatch(p, /[0O1lI]/);
  assert.notEqual(generatePassword(), p);
});

test("invite states", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  const access = (a: Partial<CandidateAccess>): CandidateAccess => ({ inviteAt: "2026-01-01T00:00:00Z", version: 0, ...a });
  assert.equal(inviteState({ status: "ready", access: access({}) }, now), "scheduled");
  assert.equal(inviteState({ status: "ready", access: access({ emailError: "x" }) }, now), "email_failed");
  const sent = access({ invitedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T01:00:00Z" });
  assert.equal(inviteState({ status: "ready", access: sent }, now), "sent");
  assert.equal(inviteState({ status: "ready", access: sent }, now + 2 * 3_600_000), "expired");
  assert.equal(accessExpired({ status: "in_progress", access: sent }, now + 2 * 3_600_000), false);
  assert.equal(inviteState({ status: "completed", access: sent }, now), null);
  assert.equal(inviteState({ status: "ready" }, now), null);
});

test("screening decisions", async () => {
  const { decide, screeningRules } = await import("../lib/screening");
  const rules = { passMark: 60, minExperience: 2 };
  const rating = (score: number) => ({ score, summary: "s", strengths: [], gaps: [] });
  assert.equal(decide(rating(60), { totalExperience: 3 }, rules).decision, "selected");
  assert.equal(decide(rating(59), { totalExperience: 3 }, rules).decision, "rejected");
  assert.equal(decide(rating(95), { totalExperience: 1 }, rules).decision, "rejected");
  const unread = decide(null, { totalExperience: 3 }, rules, "Link is private.");
  assert.equal(unread.decision, "review");
  assert.match(unread.reasons[0], /Link is private/);
  assert.deepEqual(screeningRules({}, 55), { passMark: 55, minExperience: null });
  assert.deepEqual(screeningRules({ screening: rules }), rules);
});

test("invite state while screening is pending", () => {
  const access: CandidateAccess = { inviteAt: "2026-01-01T00:00:00Z", version: 0 };
  const screening = { score: null, decision: "pending" as const, summary: "", strengths: [], gaps: [], reasons: [], at: "" };
  assert.equal(inviteState({ status: "ready", access, screening }), "screening");
});

test("job descriptions are split into headings, lists and paragraphs", async () => {
  const { jobFacts, jobSummary, parseDescription } = await import("../lib/job-text");
  const text = "JOB TYPE\n\nFull-Time | Remote\n\nEXPERIENCE\n\n3–6 Years\n\nABOUT THE ROLE\n\nWe are hiring an SEO Manager to grow organic traffic.\n\nKEY RESPONSIBILITIES\n\n- Keyword research\n- Technical audits";
  const blocks = parseDescription(text);
  assert.deepEqual(blocks[0], { kind: "heading", text: "Job type" });
  assert.deepEqual(blocks.at(-1), { kind: "list", items: ["Keyword research", "Technical audits"] });
  assert.deepEqual(jobFacts(text), ["Full-Time | Remote", "3–6 Years"]);
  assert.equal(jobSummary(text), "We are hiring an SEO Manager to grow organic traffic.");
  assert.equal(jobSummary("Plain first paragraph.\n- a bullet"), "Plain first paragraph.");
});

test("resumes are checked by their contents, not their name", async () => {
  const { resumeType, readResume } = await import("../lib/applications");
  assert.equal(resumeType(Buffer.from("%PDF-1.7 ..."))?.ext, ".pdf");
  assert.equal(resumeType(Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("....word/document.xml")]))?.ext, ".docx");
  assert.equal(resumeType(Buffer.from("<html>not a resume</html>")), null);
  await assert.rejects(readResume(new File(["<html>"], "cv.pdf")), /PDF or Word/);
  await assert.rejects(readResume(null), /attach your resume/);
  const ok = await readResume(new File(["%PDF-1.4 test"], "My CV.pdf"));
  assert.equal(ok.ext, ".pdf");
  assert.equal(ok.fileName, "My CV.pdf");
});

test("the application form is validated with every problem listed", async () => {
  const { parseApplication } = await import("../lib/applications");
  const f = new FormData();
  for (const [k, v] of Object.entries({
    fullName: "Asha K", email: "Asha@Example.com", phone: "+91 98765 43210", totalExperience: "3", currentLocation: "Delhi",
    currentCTC: "4.5", expectedCTC: "6", joiningCategory: "30_days",
  })) f.set(k, v);
  const p = parseApplication(f, "job-1");
  assert.equal(p.email, "asha@example.com");
  assert.equal(p.expectedCTC, 6);
  f.set("email", "nope");
  f.set("joiningCategory", "");
  assert.throws(() => parseApplication(f, "job-1"), /valid email[\s\S]*when you can join/);
});

test("the tracker only shows what the applicant has been told", async () => {
  const { trackerView } = await import("../lib/tracker");
  const now = Date.parse("2026-01-01T12:00:00Z");
  const base = {
    applicationRef: "GA-ABC234", jobTitle: "SEO Manager", fullName: "Asha", createdAt: "2026-01-01T10:00:00Z",
    status: "ready" as const, access: { inviteAt: "2026-01-01T12:00:00Z", version: 0 } as CandidateAccess,
    screening: { score: 82, decision: "selected" as const, summary: "", strengths: [], gaps: [], reasons: [], at: "" },
  };
  // Shortlisted internally, but the email hasn't gone out: still "being reviewed".
  let v = trackerView(base, now);
  assert.match(v.headline, /being reviewed/);
  assert.ok(!JSON.stringify(v).includes("82"), "no scores");

  v = trackerView({ ...base, access: { ...base.access, invitedAt: "2026-01-01T12:00:00Z", expiresAt: "2026-01-02T12:00:00Z" } }, now);
  assert.match(v.headline, /shortlisted/);
  assert.equal(v.interview?.startBy, "2026-01-02T12:00:00Z");

  v = trackerView({ ...base, access: { ...base.access, invitedAt: "x", expiresAt: "2026-01-01T11:00:00Z" } }, now);
  assert.match(v.headline, /window has ended/);

  const rejected = { ...base, status: "rejected" as const, screening: { ...base.screening, decision: "rejected" as const } };
  assert.match(trackerView(rejected, now).headline, /being reviewed/, "rejection not shown before its email");
  assert.match(trackerView({ ...rejected, screening: { ...rejected.screening, rejectionEmailedAt: "2026-01-01T12:00:00Z" } }, now).headline, /wasn't selected/);

  v = trackerView({ ...base, status: "completed", completedAt: "2026-01-01T13:00:00Z", access: { ...base.access, invitedAt: "x" } }, now);
  assert.match(v.headline, /with the hiring team/);
});
