import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePassword } from "../lib/access";
import { parseLakhs, parseNumber, parseResponse, responseCandidateId } from "../lib/intake";
import { accessExpired, inviteState } from "../lib/invite-state";
import { downloadUrl, isPrivateAddress } from "../lib/resume-link";
import type { CandidateAccess, GoogleJobForm } from "../lib/types";

test("numbers and salaries from free text", () => {
  assert.equal(parseNumber("4.5 years"), 4.5);
  assert.equal(parseNumber("₹6,00,000"), 600000);
  assert.ok(Number.isNaN(parseNumber("fresher")));
  assert.equal(parseLakhs("6 LPA"), 6);
  assert.equal(parseLakhs("600000"), 6);
  assert.equal(parseLakhs("4,50,000"), 4.5);
});

test("Google Drive and Docs links become direct downloads", () => {
  assert.equal(
    downloadUrl("https://drive.google.com/file/d/1AbC_x-9/view?usp=sharing"),
    "https://drive.google.com/uc?export=download&id=1AbC_x-9",
  );
  assert.equal(downloadUrl("https://drive.google.com/open?id=XYZ"), "https://drive.google.com/uc?export=download&id=XYZ");
  assert.equal(
    downloadUrl("https://docs.google.com/document/d/DOC1/edit"),
    "https://docs.google.com/document/d/DOC1/export?format=pdf",
  );
  assert.equal(downloadUrl("https://example.com/cv.pdf"), "https://example.com/cv.pdf");
});

test("private and internal addresses are refused for resume links", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "142.250.1.1", "2607:f8b0::1"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("passwords avoid look-alike characters and differ each time", () => {
  const p = generatePassword();
  assert.equal(p.length, 10);
  assert.doesNotMatch(p, /[0O1lI]/);
  assert.notEqual(generatePassword(), p);
});

test("a form response maps to one stable candidate id", () => {
  assert.equal(responseCandidateId("F", "R"), responseCandidateId("F", "R"));
  assert.notEqual(responseCandidateId("F", "R"), responseCandidateId("F", "R2"));
  assert.match(responseCandidateId("F", "R"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

const form: GoogleJobForm = {
  formId: "F",
  responderUri: "https://forms/x",
  owner: "o",
  createdAt: "",
  emailFromSettings: true,
  questionIds: { fullName: "q1", currentCTC: "q2", expectedCTC: "q3", joiningCategory: "q4", totalExperience: "q5" },
};
const answer = (value: string) => ({ textAnswers: { answers: [{ value }] } });

test("form responses are read into a profile", () => {
  const r = parseResponse(form, "job", {
    responseId: "r",
    lastSubmittedTime: "2026-01-01T00:00:00Z",
    respondentEmail: " Asha@Example.com ",
    answers: { q1: answer("Asha K"), q2: answer("4.5 LPA"), q3: answer("600000"), q4: answer("Within 30 days"), q5: answer("3 yrs") },
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.profile.email, "asha@example.com");
  assert.equal(r.profile.currentCTC, 4.5);
  assert.equal(r.profile.expectedCTC, 6);
  assert.equal(r.profile.joiningCategory, "30_days");
  assert.equal(r.profile.totalExperience, 3);
});

test("responses without a valid email are refused", () => {
  const r = parseResponse(form, "job", { responseId: "r", lastSubmittedTime: "", answers: { q1: answer("X") } });
  assert.deepEqual(r, { ok: false, name: "X", reason: "No valid email address" });
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
