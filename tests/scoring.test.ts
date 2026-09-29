import assert from "node:assert/strict";
import { test } from "node:test";
import { computeScores, joiningScore, salaryScore } from "../lib/scoring";

const budget = { salaryMin: 6, salaryMax: 10 };

test("salary: at or below the budget minimum gets the full +15", () => {
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 5, ...budget }).points, 15);
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 6, ...budget }).points, 15);
});

test("salary: falls linearly to +5 at the budget maximum", () => {
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 8, ...budget }).points, 10);
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 10, ...budget }).points, 5);
});

test("salary: over-budget bands", () => {
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 11, ...budget }).points, 0); // 10% over
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 12.5, ...budget }).points, -5); // 25% over
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 13, ...budget }).points, -10);
});

test("salary: hike penalty over current CTC, skipped for freshers", () => {
  // 8 LPA is +10 on budget; 60% hike over 5 LPA is -5.
  assert.equal(salaryScore({ currentCTC: 5, expectedCTC: 8, ...budget }).points, 5);
  // 40% hike: -2.
  assert.equal(salaryScore({ currentCTC: 5.7, expectedCTC: 8, ...budget }).points, 8);
  assert.equal(salaryScore({ currentCTC: 0, expectedCTC: 8, ...budget }).points, 10);
});

test("salary: no budget set skips the budget check", () => {
  const s = salaryScore({ currentCTC: 0, expectedCTC: 50, salaryMin: null, salaryMax: null });
  assert.equal(s.points, 0);
  assert.match(s.notes[0], /No salary budget/);
});

test("salary: total is clamped to -15", () => {
  assert.equal(salaryScore({ currentCTC: 1, expectedCTC: 20, ...budget }).points, -15);
});

test("joining: known and unknown categories", () => {
  assert.equal(joiningScore("immediate").points, 15);
  assert.equal(joiningScore("90_plus").points, -10);
  assert.equal(joiningScore("someday").points, 0);
});

test("total and recommendation", () => {
  const strong = computeScores({
    questionScores: [9, 9, 8, 9, 9, 10],
    joiningCategory: "immediate",
    currentCTC: 0,
    expectedCTC: 6,
    job: budget,
  });
  assert.equal(strong.interview.points, 63);
  assert.equal(strong.total, 93);
  assert.equal(strong.recommendation, "Strong Hire");

  const none = computeScores({ questionScores: [], joiningCategory: "90_plus", currentCTC: 0, expectedCTC: 13, job: budget });
  assert.equal(none.total, -20);
  assert.equal(none.recommendation, "Reject");
});
