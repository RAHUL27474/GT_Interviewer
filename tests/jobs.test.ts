import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../lib/http";
import { parseJob } from "../lib/jobs";

test("parses a job and makes an id from the title", () => {
  const job = parseJob({ title: " Service Advisor ", description: "Handle customers", salaryMin: "3", salaryMax: 5 });
  assert.match(job.id, /^service-advisor-[0-9a-f]{6}$/);
  assert.equal(job.title, "Service Advisor");
  assert.equal(job.salaryMin, 3);
  assert.equal(job.salaryMax, 5);
  assert.equal(job.active, true);
});

test("keeps the id when editing, and empty salary means no budget", () => {
  const existing = parseJob({ title: "A", description: "B" });
  const edited = parseJob({ title: "Renamed", description: "B", salaryMin: "", active: false }, existing);
  assert.equal(edited.id, existing.id);
  assert.equal(edited.salaryMin, null);
  assert.equal(edited.active, false);
});

test("rejects missing fields and bad salaries", () => {
  assert.throws(() => parseJob({ title: "", description: "x" }), HttpError);
  assert.throws(() => parseJob({ title: "x", description: "x", salaryMin: -1 }), /positive/);
  assert.throws(() => parseJob({ title: "x", description: "x", salaryMin: 9, salaryMax: 5 }), /above max/);
});
