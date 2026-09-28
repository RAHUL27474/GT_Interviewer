/**
 * Checks the notification layer without sending anything.
 *
 * `buildMessage` is pure, so the real templates are inspected here. The safety
 * properties worth locking down are the ones that would be embarrassing to get
 * wrong: no score ever reaches a candidate, no candidate is ever told they were
 * rejected, and a candidate-supplied name cannot inject HTML into an HR inbox.
 *
 * Every test is synchronous, so this uses `syncSuite` and each `test` runs
 * inline. Run it on its own with:
 *   node --env-file-if-exists=.env --import tsx lib/notify.test.ts
 */

import { assert, syncSuite } from "./test-harness";
import { config } from "./config";
import { buildMessage, notificationsEnabled } from "./notify";
import type { Candidate } from "./types";

const { test, done } = syncSuite("notify");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "abc-123",
    createdAt: new Date().toISOString(),
    fullName: "Alex Mercer",
    email: "alex@example.com",
    phone: "+1 555 0100",
    jobId: "job-1",
    jobTitle: "Backend Engineer",
    jobSnapshot: { title: "Backend Engineer", description: "Python and Django.", salaryMin: null, salaryMax: null },
    resume: { fileName: "resume.pdf", storedAs: "abc-123.pdf" },
    profileComplete: true,
    status: "screening",
    questions: [],
    answers: [],
    proctoring: { events: [] },
    ...overrides,
  } as Candidate;
}

const shortlistReport = {
  score: 88,
  summary: "Strong match.",
  strengths: ["Matches 6 of 7 required skills."],
  gaps: [],
  recommendation: "advance" as const,
  engine: "bridge" as const,
  status: "SHORTLISTED" as const,
  scores: {
    requiredSkills: 86,
    experience: 93,
    education: 100,
    projects: 92,
    semantic: 76,
    finalScore: 88,
    nativeScreeningScore: 80,
    semanticSimilarity: 0.52,
    skillCoveragePercent: 85.7,
    threshold: 75,
    reviewThreshold: 50,
    marginToThreshold: 13,
  },
  requiredSkills: ["python"],
  matchedSkills: ["python"],
  missingSkills: [],
  bonusSkills: [],
  recommendedNextStep: "AI Interview",
};

console.log(`Provider: ${config.notifyEmailProvider || "unset"}, enabled: ${notificationsEnabled()}\n`);

// 1. Nothing is configured, so the app must report "off" rather than erroring.
console.log("1. Disabled by default");
if (config.notifyEmailProvider === "none") {
  test("reports disabled with no provider", () => assert.ok(!notificationsEnabled()));
} else {
  console.log("  note  NOTIFY_EMAIL_PROVIDER is set; asserting the disabled path anyway");
  test("enabled only when provider, key and sender are all present", () =>
    assert.equal(notificationsEnabled(), Boolean(config.notifyEmailApiKey && config.notifyFromEmail)),
  );
}

// 2. The interview mail must contain a working link. A candidate only gets one
//    once screening has actually shortlisted them, so the fixture is shortlisted.
console.log("\n2. interview_ready carries the interview link");
const ready = buildMessage("interview_ready", candidate({ resumeScreening: shortlistReport }));
test("message built for a shortlisted candidate", () => assert.notEqual(ready, null));
test("addressed to the candidate", () => assert.equal(ready?.to, "alex@example.com"));
test("names the position", () => assert.ok((ready?.subject ?? "").includes("Backend Engineer"), ready?.subject ?? ""));
const expectedLink = `${config.appUrl}/interview/abc-123`;
test("html contains the interview URL", () => assert.ok((ready?.html ?? "").includes(expectedLink), expectedLink));
test("plain text contains the interview URL", () => assert.ok((ready?.text ?? "").includes(expectedLink)));
test("link is absolute, not a relative path", () => assert.ok(expectedLink.startsWith("http"), expectedLink));

// 3. The safety property: no score ever leaves the building.
console.log("\n3. No score is ever shown to a candidate");
for (const event of ["application_received", "interview_ready"] as const) {
  const message = buildMessage(event, candidate({ resumeScreening: shortlistReport }));
  const text = `${message?.subject ?? ""} ${message?.html ?? ""} ${message?.text ?? ""}`;
  test(`${event} leaks no score`, () => assert.ok(!/\b88\b|\b86\b|\b76\b|100/.test(text), text.slice(0, 60)));
  test(`${event} does not mention a score or threshold`, () =>
    assert.ok(!/score|threshold|shortlist at|\/100/i.test(text)),
  );
}

// 4. The safety property: nothing is ever auto-rejected.
console.log("\n4. No rejection message exists");
const notShortlisted = candidate({
  status: "awaiting_screening",
  resumeScreening: {
    ...shortlistReport,
    status: "NOT_SHORTLISTED",
    recommendation: "hr_review",
    scores: { ...shortlistReport.scores, finalScore: 31 },
  },
});
test("no interview mail for a not-shortlisted candidate", () =>
  assert.equal(buildMessage("interview_ready", notShortlisted), null),
);
const acknowledgement = buildMessage("application_received", notShortlisted);
test("a not-shortlisted candidate still gets only a neutral acknowledgement", () =>
  assert.ok(
    acknowledgement !== null &&
      !/reject|not shortlisted|unsuccessful|unfortunately|regret/i.test(
        `${acknowledgement.subject} ${acknowledgement.html} ${acknowledgement.text}`,
      ),
  ),
);
test("no interview mail before screening has run", () => assert.equal(buildMessage("interview_ready", candidate()), null));

// HR overriding the model is a legitimate outcome. That candidate has a real
// interview and is waiting on the page, so they must be told just the same.
const hrOverride = buildMessage(
  "interview_ready",
  candidate({ status: "ready", resumeScreening: { ...shortlistReport, status: "NOT_SHORTLISTED", recommendation: "hr_review" } }),
);
test("interview mail sent when HR overrides the model", () => assert.notEqual(hrOverride, null));
test("the override mail still contains no score", () =>
  assert.ok(
    !/\/100|\bscore\b/i.test(`${hrOverride?.subject ?? ""} ${hrOverride?.html ?? ""} ${hrOverride?.text ?? ""}`),
  ),
);
test("the override mail never says the candidate was rejected", () =>
  assert.ok(!/reject|not shortlisted|unfortunately|regret/i.test(`${hrOverride?.html ?? ""} ${hrOverride?.text ?? ""}`)),
);

// Every status that opens the interview must be allowed through, and every
// status that leaves the candidate waiting must not.
console.log("\n4b. Only an open interview is ever mailed");
for (const [status, shouldSend] of [
  ["awaiting_screening", false],
  ["screening", false],
  ["profile_pending", true],
  ["ready", true],
  ["in_progress", true],
  ["completed", true],
] as const) {
  const message = buildMessage("interview_ready", candidate({ status }));
  test(`${status} ${shouldSend ? "receives" : "does not receive"} the interview link`, () =>
    assert.equal(message !== null, shouldSend),
  );
}

// 5. HR is alerted only about the review queue, and the score may appear there.
console.log("\n5. HR review alert");
const reviewAlert = buildMessage("awaiting_hr_review", notShortlisted);
test("message built", () => assert.notEqual(reviewAlert, null));
test("goes to HR, not the candidate", () => assert.notEqual(reviewAlert?.to, "alex@example.com"));
test("includes the score for the reviewer", () => assert.ok((reviewAlert?.text ?? "").includes("31/100")));
test("points at the dashboard", () => assert.ok((reviewAlert?.html ?? "").includes("/admin")));
test("states nothing was auto-rejected", () =>
  assert.ok(/nothing was rejected automatically/i.test(reviewAlert?.text ?? "")),
);

// 6. A candidate-supplied name must not be able to inject HTML into HR's inbox.
console.log("\n6. Candidate name cannot inject HTML");
const hostile = candidate({ fullName: '<img src=x onerror="alert(1)">Priya' });
const hostileMessage = buildMessage("awaiting_hr_review", hostile);
test("raw tag is escaped in html", () => assert.ok(!(hostileMessage?.html ?? "").includes("<img")));
test("escaped entity is present instead", () => assert.ok((hostileMessage?.html ?? "").includes("&lt;img")));
test("no script tag survives", () => assert.ok(!/<script/i.test(hostileMessage?.html ?? "")));

// 7. A candidate with no name must still produce a sensible message.
console.log("\n7. Missing name degrades gracefully");
const nameless = buildMessage("application_received", candidate({ fullName: "" }));
test("message still built", () => assert.notEqual(nameless, null));
test("no 'undefined' in the body", () =>
  assert.ok(!/undefined|null/.test(`${nameless?.html ?? ""} ${nameless?.text ?? ""}`)),
);

// 8. An unknown event is refused rather than guessed at.
console.log("\n8. Unknown event");
test("unknown event returns null", () => assert.equal(buildMessage("rejected" as never, candidate()), null));

done();
