import assert from "node:assert/strict";
import { test } from "node:test";
import { computeIntegrity } from "../lib/proctoring";
import type { ProctorEvent, ProctorEventType } from "../lib/types";

const ev = (type: ProctorEventType): ProctorEvent => ({
  type,
  at: "2026-01-01T00:00:00.000Z",
  questionIndex: 0,
  detail: "",
  snapshot: null,
});

test("no events is low risk", () => {
  assert.deepEqual(computeIntegrity([]), { level: "low", points: 0, counts: {} });
});

test("weights add up to medium and high", () => {
  const medium = computeIntegrity([ev("face_missing"), ev("left_window")]);
  assert.equal(medium.points, 4);
  assert.equal(medium.level, "medium");
  assert.equal(medium.counts.face_missing, 1);

  const high = computeIntegrity([ev("different_person"), ev("multiple_faces"), ev("phone_detected")]);
  assert.equal(high.points, 11);
  assert.equal(high.level, "high");
});

test("informational events carry no weight", () => {
  assert.equal(computeIntegrity([ev("proctoring_unavailable")]).level, "low");
});
