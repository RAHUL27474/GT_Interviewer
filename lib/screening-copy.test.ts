/**
 * Locks down what a candidate is shown after Round 1 screening.
 *
 * `lib/notify.test.ts` already guards the email side of this. This guards the
 * page, which is where the leak actually happened: the held states read "close
 * to the shortlist mark" and "did not reach the shortlist", which between them
 * disclosed a score band and presented an automated rejection as final.
 *
 * These assertions are on the words themselves, so a copy edit that reintroduces
 * the problem fails here rather than in a candidate's inbox.
 *
 * Run it on its own with:
 *   node --env-file-if-exists=.env --import tsx lib/screening-copy.test.ts
 */

import { assert, syncSuite } from "./test-harness";
import {
  OUTCOME_COPY,
  SCREENING_ERROR_COPY,
  SCREENING_PENDING_COPY,
  UNDER_REVIEW,
  heldCandidateCopy,
} from "./screening-copy";

const { test, done } = syncSuite("screening copy");

/** Every string a candidate could be shown, joined for pattern matching. */
const visible = (): string =>
  [
    ...Object.values(OUTCOME_COPY).flatMap((c) => [c.heading, c.body, c.pill]),
    SCREENING_ERROR_COPY.heading,
    SCREENING_ERROR_COPY.body,
    SCREENING_PENDING_COPY.heading,
    SCREENING_PENDING_COPY.body,
  ].join("  |  ");

const all = visible();

/* ------------------------------------------------- never disclose a score */

test("no number that could be read as a score reaches a candidate", () =>
  assert.ok(!/\b\d{1,3}\s*(\/|out of)\s*100\b/.test(all), `a score-shaped value appears in: ${all}`));

test("no percentage appears at all", () =>
  assert.ok(!/\d+\s*%/.test(all), `a percentage appears in: ${all}`));

test("the words score, threshold, cutoff and shortlist mark never appear", () =>
  assert.ok(
    !/\bscore\b|\bthreshold\b|\bcut-?off\b|shortlist mark|\/100/i.test(all),
    `scoring vocabulary leaked into candidate copy: ${all}`,
  ));

test("no near-miss hint, which is a score band in different words", () =>
  assert.ok(
    !/close to|came close|nearly|marginal|just missed|almost made|below the (bar|mark|cut)/i.test(all),
    `a near-miss hint leaked into: ${all}`,
  ));

/* --------------------------------------------- never auto-reject a candidate */

test("no held state tells the candidate they were rejected or missed out", () =>
  assert.ok(
    !/did not reach|not shortlisted|unsuccessful|we regret|unfortunately|rejected|you did not qualify|not selected/i.test(all),
    `candidate copy states a rejection: ${all}`,
  ));

test("no held state thanks the candidate for applying, which reads as a closing", () =>
  assert.ok(
    !/thank you for applying|we wish you luck|we'll be in touch/i.test(all),
    `candidate copy reads as a final decision: ${all}`,
  ));

/* ------------------------------------------- the two held states are one message */

test("HR_REVIEW and NOT_SHORTLISTED show the candidate identical copy", () => {
  assert.deepEqual(OUTCOME_COPY.HR_REVIEW, OUTCOME_COPY.NOT_SHORTLISTED);
  assert.equal(OUTCOME_COPY.HR_REVIEW, UNDER_REVIEW);
  assert.equal(OUTCOME_COPY.NOT_SHORTLISTED, UNDER_REVIEW);
});

test("a held candidate is told plainly that they are under review", () => {
  assert.match(UNDER_REVIEW.body, /under review/i);
  assert.equal(UNDER_REVIEW.pill, "Under review");
});

test("a held candidate is told there is nothing to do, so they do not chase", () =>
  assert.match(UNDER_REVIEW.body, /nothing you need to do/i));

test("a held candidate is told a person is involved, never that the system decided", () =>
  assert.ok(
    /personally|person|someone|human/i.test(UNDER_REVIEW.body),
    `nothing reassures that a human decides: ${UNDER_REVIEW.body}`,
  ));

/* ------------------------------------------------- the shortlisted path is intact */

test("a shortlisted candidate is told they move to the video interview", () => {
  assert.match(OUTCOME_COPY.SHORTLISTED.body, /video interview/i);
  assert.equal(OUTCOME_COPY.SHORTLISTED.pill, "Shortlisted");
});

test("a shortlisted candidate is not left thinking they are still waiting", () =>
  assert.ok(
    !/under review/i.test(OUTCOME_COPY.SHORTLISTED.body),
    `the shortlisted copy still reads as a hold: ${OUTCOME_COPY.SHORTLISTED.body}`,
  ));

/* ------------------------------------------------------------ the pending state */

test("the pending state promises the interview route, not a score", () => {
  assert.match(SCREENING_PENDING_COPY.body, /shortlisted/i);
  assert.match(SCREENING_PENDING_COPY.body, /video interview/i);
});

test("a screening failure is a hold, never a rejection", () => {
  assert.match(SCREENING_ERROR_COPY.body, /hiring team/i);
  assert.ok(
    !/reject|not shortlisted|unsuccessful|unfortunately|regret/i.test(SCREENING_ERROR_COPY.body),
    `the error copy states a rejection: ${SCREENING_ERROR_COPY.body}`,
  );
});

test("every state has a heading, a body and a pill", () => {
  for (const [status, copy] of Object.entries(OUTCOME_COPY)) {
    assert.ok(copy.heading.length > 0, `${status} has no heading`);
    assert.ok(copy.body.length > 0, `${status} has no body`);
    assert.ok(copy.pill.length > 0, `${status} has no pill`);
  }
});

/* --------------------------------- the resolver keeps the internal label server-side */

test("screening still running has no copy yet", () => {
  assert.equal(heldCandidateCopy({ status: "screening" }), null);
});

test("each held state resolves to copy that names no status", () => {
  for (const status of ["HR_REVIEW", "NOT_SHORTLISTED"] as const) {
    const copy = heldCandidateCopy({ status: "awaiting_screening", resumeScreening: { status } });
    assert.ok(copy, `${status} resolved to no copy`);
    // The whole point of resolving on the server: what crosses to the browser is
    // the finished sentence, never the enum member. JSON.stringify is the exact
    // form the RSC flight payload embeds in the page source.
    const serialised = JSON.stringify(copy);
    assert.ok(!serialised.includes("SHORTLISTED"), `${status} leaked its label: ${serialised}`);
    assert.ok(!serialised.includes("NOT_SHORTLISTED"), `${status} leaked its label: ${serialised}`);
    assert.ok(!/NOT_SHORTLISTED|HR_REVIEW/.test(serialised), `${status} leaked its label: ${serialised}`);
  }
});

test("both held states resolve to the identical object", () =>
  assert.equal(
    heldCandidateCopy({ status: "awaiting_screening", resumeScreening: { status: "HR_REVIEW" } }),
    heldCandidateCopy({ status: "awaiting_screening", resumeScreening: { status: "NOT_SHORTLISTED" } }),
  ));

test("a screening error resolves to a hold, and hides the error itself", () => {
  const copy = heldCandidateCopy({
    status: "awaiting_screening",
    screeningError: "ECONNREFUSED 10.0.0.4:5432 postgres: connection refused",
  });
  assert.equal(copy, SCREENING_ERROR_COPY);
  assert.ok(!JSON.stringify(copy).includes("ECONNREFUSED"), "an internal error string reached the candidate");
});

test("a held record with no report still says under review, not nothing", () => {
  assert.equal(heldCandidateCopy({ status: "awaiting_screening" }), UNDER_REVIEW);
});

done();
