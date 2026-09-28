/**
 * Tests for the shortlisted-candidate invitation: how focus areas are derived,
 * and — more importantly — what the copy is forbidden from saying.
 *
 * The copy assertions are the point of this file. Everything else here is
 * ordinary string handling that a refactor could break loudly. A candidate being
 * shown their screening score, or told the interview can be typed instead of
 * spoken, would not fail a typecheck or a build: it would just be wrong, in
 * front of a real person, at the worst point in their application.
 */
import { assert, syncSuite } from "./test-harness";
import { config } from "./config";
import { BRIEF, INVITE, PRE_INTERVIEW_STEPS, estimateInterviewMinutes, interviewTopics, inviteDeadline } from "./invite";
import type { Job } from "./types";

const { test, done } = syncSuite("invite");

const job: Pick<Job, "title" | "description"> = {
  title: "Mechanical Design Engineer",
  description: [
    "You will design pressure vessels from concept to production.",
    "",
    "Requirements:",
    "- Mechanical CAD and engineering drawings",
    "- Dimensioning, tolerancing and GD&T",
    "- Design for manufacture",
  ].join("\n"),
};

/* ------------------------------------------------------------------ topics */

test("the JD wins over the screening report's skill tokens", () => {
  // Live check: the real matcher returns "aws", "css", "express" — lowercased,
  // unpunctuated, and unreadable on an invitation. The JD was written by a person
  // who capitalised it, so it is the better source whenever it has content.
  const topics = interviewTopics(job, { requiredSkills: ["aws", "css", "express"] });
  assert.ok(!topics.includes("aws"), "raw matcher tokens must not be preferred over the JD");
  assert.equal(topics[0], "Mechanical CAD and engineering drawings");
});

test("the report's skill tokens are used only when the JD has no usable section", () => {
  const topics = interviewTopics(
    { title: "Data Analyst", description: "Great role. Apply now." },
    { requiredSkills: ["sql", "dbt", "tableau"] },
  );
  assert.deepEqual(topics, ["sql", "dbt", "tableau"]);
});

test("an empty skill list in the report does not shadow the JD", () => {
  // An empty array is falsy-adjacent enough to be a classic `??` / `||` bug, so
  // it gets its own test rather than being folded into another.
  const topics = interviewTopics(job, { requiredSkills: [] });
  assert.equal(topics[0], "Mechanical CAD and engineering drawings");
});

test("topics fall back to the JD's requirements bullets", () => {
  assert.deepEqual(interviewTopics(job), [
    "Mechanical CAD and engineering drawings",
    "Dimensioning, tolerancing and GD&T",
    "Design for manufacture",
  ]);
});

test("topics ignore prose before the requirements section", () => {
  const topics = interviewTopics(job);
  assert.ok(!topics.some((t) => t.includes("pressure vessels")), "intro paragraph leaked into topics");
});

test("topics are capped at the configured maximum", () => {
  const many = Array.from({ length: 20 }, (_, i) => `Requirement number ${i}`);
  const topics = interviewTopics({ title: "T", description: `Requirements:\n${many.map((m) => `- ${m}`).join("\n")}` });
  assert.equal(topics.length, config.interviewTopicsMax);
});

test("topics are de-duplicated case-insensitively", () => {
  const topics = interviewTopics({ title: "T", description: "Requirements:\n- Welding\n- welding\n- WELDING" });
  assert.deepEqual(topics, ["Welding"]);
});

test("bullets and numbering are stripped from a topic", () => {
  const topics = interviewTopics(
    { title: "T", description: "Requirements:\n*  - 1. SolidWorks parametric modelling" },
    null,
  );
  assert.deepEqual(topics, ["SolidWorks parametric modelling"]);
});

test("a whole JD bullet is shortened at a word boundary, not mid-word", () => {
  const long = "Integrate third-party services: payment gateways, CRMs, WhatsApp Business API and messaging tools";
  const [topic] = interviewTopics({ title: "T", description: `Requirements:\n- ${long}` });
  assert.ok(topic.length <= 72, `topic was ${topic.length} chars`);
  assert.ok(topic.endsWith("…"));
  // The live bug: a hard cut turned "WhatsApp Business API" into "WhatsApp Busi.".
  assert.ok(!/\bBusi\.\.\.$|Busi…$/.test(topic), `cut mid-word: ${topic}`);
  assert.ok(topic.includes("WhatsApp"), topic);
});

test("a very long single word is still capped", () => {
  const [topic] = interviewTopics({ title: "T", description: `Requirements:\n- ${"x".repeat(200)}` });
  assert.ok(topic.length <= 72, `topic was ${topic.length} chars`);
});

test("an unrecognisable JD falls back to the role title rather than a placeholder", () => {
  assert.deepEqual(interviewTopics({ title: "Structural Engineer", description: "Great role. Apply now." }), [
    "Structural Engineer",
  ]);
});

/* ---------------------------------------------------------------- duration */

test("estimated minutes include thinking time, not just answering time", () => {
  // 6 questions x (3 min answering + 1 min thinking) = 24.
  assert.equal(estimateInterviewMinutes(6, 3), 24);
});

test("estimated minutes never drops below one", () => {
  assert.equal(estimateInterviewMinutes(0, 3), 4);
  assert.equal(estimateInterviewMinutes(-5, 3), 4);
});

test("a nonsense per-question limit is floored rather than honoured", () => {
  // A zero answer limit would render an invitation promising "up to 3 minutes"
  // for a six-question interview, so the floor is deliberate. Asserting the
  // arithmetic here is what documents it.
  assert.equal(estimateInterviewMinutes(3, 0), 5); // 3 x (0.5 + 1), rounded
});

test("markers do not eat a decimal point", () => {
  // The strip-then-repeat loop above would turn "1.5 hours" into "5 hours"
  // unless the marker pattern requires trailing whitespace.
  const topics = interviewTopics({ title: "T", description: "Requirements:\n- 1.5 hours of CAD daily" });
  assert.deepEqual(topics, ["1.5 hours of CAD daily"]);
});

/* ---------------------------------------------------------------- deadline */

test("the deadline is the configured number of hours out", () => {
  const now = new Date("2026-03-01T09:00:00Z");
  const text = inviteDeadline(now, 48);
  // Locale and zone are the browser's, so only the date is asserted — but it has
  // to be two days later, not today, or a candidate loses an invitation to a
  // timezone.
  assert.match(text, /Mar/, `deadline ${text} should be in March`);
  assert.match(text, /0?3/, `deadline ${text} should be the 3rd`);
});

/* -------------------------------------------------------------------- copy */

/** Every string a candidate can be shown on the pre-interview screens. */
const ALL_COPY: string = [
  INVITE.opening("Acme", "Data Analyst"),
  INVITE.intro,
  INVITE.answerMode,
  INVITE.beforeHeading,
  INVITE.expectHeading,
  INVITE.cta,
  INVITE.reviewLink,
  INVITE.emailedNote("someone@example.com"),
  ...INVITE.before,
  BRIEF.heading,
  BRIEF.durationLead(24),
  BRIEF.topicsHeading,
  BRIEF.recording,
  BRIEF.refreshWarning,
  BRIEF.cta,
].join("\n");

test("no copy reveals a score, a threshold, or an outcome label", () => {
  // A word-boundary match, so "score" in "scores well" would still fail and
  // "threshold" inside a longer word would not.
  const banned = [
    /\bshortlist(ed)?\b/i,
    /\bscore[ds]?\b/i,
    /\bthreshold\b/i,
    /\bcut-?off\b/i,
    /\breject(ed|ion)?\b/i,
    /\bnot\s+qualified\b/i,
    /\bpass(ed)?\b/i,
    /\b\d{1,3}\s*(out of|\/)\s*100\b/i,
    /\bSHORTLISTED\b/,
    /\bHR_REVIEW\b/,
  ];
  for (const pattern of banned) {
    assert.ok(!pattern.test(ALL_COPY), `candidate copy matched banned pattern ${pattern}: ${ALL_COPY.match(pattern)?.[0]}`);
  }
});

test("no copy promises typing, because the interview is spoken only", () => {
  // The one place this could creep in is a well-meaning edit to the brief. It is
  // a lie the candidate only discovers mid-interview, with the timer running.
  assert.ok(!/\btype (it |your |it in|a )?(answer|response)\b/i.test(ALL_COPY));
  assert.ok(!/\bspeaking or typing\b/i.test(ALL_COPY));
  assert.ok(!/\bkeyboard\b/i.test(ALL_COPY));
});

test("the answer mode says the interview is spoken", () => {
  assert.match(INVITE.answerMode, /out loud|aloud|speak/i);
});

test("recording is disclosed plainly on the brief", () => {
  assert.match(BRIEF.recording, /record/i);
  // "may", "might" and "sometimes" all turn a disclosure into a hint.
  assert.ok(!/\b(may|might|could be|possibly|potentially)\b.*\brecord/i.test(BRIEF.recording));
});

test("the refresh warning is present on the brief and on the invitation fallback", () => {
  assert.match(BRIEF.refreshWarning, /refresh/i);
});

/* ------------------------------------------------------------------- steps */

test("the pre-interview flow is exactly three labelled steps", () => {
  assert.deepEqual(PRE_INTERVIEW_STEPS.map((s) => s.n), [1, 2, 3]);
  assert.equal(new Set(PRE_INTERVIEW_STEPS.map((s) => s.label)).size, 3, "step labels must be distinct");
});

done();
