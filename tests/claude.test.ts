// The Claude path with the real Anthropic SDK and a simulated API: what the app sends (model, thinking, effort,
// structured output, fallbacks, PDF and image blocks) and how it handles answers, refusals and errors.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, beforeEach, test } from "node:test";
import type { Candidate } from "../lib/types";

type Sent = { url: string; method: string; headers: Record<string, string>; body: any };
const sent: Sent[] = [];
let reply: (req: Sent) => Response;

const message = (text: string, stop_reason = "end_turn", extra: object = {}) =>
  Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  });

let ai: typeof import("../lib/ai");
let claude: typeof import("../lib/ai/claude");

before(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-test-"));
  Object.assign(process.env, { DATA_DIR: dataDir, S3_BUCKET: "", DATABASE_URL: "", ANTHROPIC_API_KEY: "sk-ant-test-key", AI_PROVIDER: "", CLAUDE_MODEL: "", CLAUDE_FALLBACKS: "", LOG_LEVEL: "error" });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const req: Sent = { url, method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : null };
    sent.push(req);
    return reply(req);
  }) as typeof fetch;
  ai = await import("../lib/ai");
  claude = await import("../lib/ai/claude");
});
beforeEach(() => {
  sent.length = 0;
});

const job = { title: "AI Intern", description: "Python, LLMs, RAG" };
const profile = {
  fullName: "Asha K", email: "a@example.com", phone: "1", jobId: "j", totalExperience: 1, currentLocation: "Delhi",
  linkedin: "", currentCTC: 0, expectedCTC: 2, joiningCategory: "immediate",
};
const pdf = { kind: "pdf" as const, title: "Candidate resume", base64: Buffer.from("%PDF-1.4 test").toString("base64") };

test("the active provider is Claude once a real key is set", async () => {
  const { config } = await import("../lib/config");
  assert.equal(config.aiProvider, "claude");
  assert.equal(config.claudeModel, "claude-opus-5");
});

test("question generation: request shape and parsed result", async () => {
  const questions = [{ question: "Walk me through a RAG pipeline you built.", focus: "RAG", based_on: "resume", expected_points: ["a", "b", "c"] }];
  reply = () => message(JSON.stringify({ questions }));
  const result = await ai.generateQuestions({ job, candidate: profile, resumePart: pdf });
  assert.deepEqual(result, questions);

  const req = sent[0];
  assert.match(req.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(req.headers["x-api-key"], "sk-ant-test-key");
  assert.match(req.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.model, "claude-opus-5");
  assert.deepEqual(req.body.thinking, { type: "adaptive" });
  assert.equal(req.body.output_config.effort, "medium");
  assert.equal(req.body.output_config.format.type, "json_schema");
  assert.equal(req.body.output_config.format.schema.additionalProperties, false);
  assert.equal(req.body.fallbacks, "default");
  assert.equal(req.body.temperature, undefined, "no sampling params on this model");
  const content = req.body.messages[0].content;
  assert.equal(content[0].type, "document");
  assert.equal(content[0].source.media_type, "application/pdf");
  assert.equal(content.at(-1).type, "text");
});

test("resume screening: score is clamped to 0-100", async () => {
  reply = () => message(JSON.stringify({ score: 140, summary: "Strong", strengths: ["Python"], gaps: [] }));
  const rating = await ai.screenResume({ job, candidate: profile, resumePart: pdf });
  assert.equal(rating.score, 100);
  assert.equal(sent[0].body.output_config.effort, "medium");
});

test("grading: high effort, snapshots sent as images, scores mapped per question", async () => {
  const { files, mediaKey } = await import("../lib/files");
  const c = {
    id: "grade-test",
    fullName: "Asha K",
    totalExperience: 1,
    currentLocation: "Delhi",
    jobSnapshot: { title: job.title, description: job.description, salaryMin: null, salaryMax: null },
    questions: [
      { question: "Q1?", focus: "f", based_on: "job_description", expected_points: ["p"] },
      { question: "Q2?", focus: "f", based_on: "job_description", expected_points: ["p"] },
    ],
    answers: [{ transcript: "My answer", timeTakenSec: 60, submittedAt: "", video: null, snapshots: ["s0.jpg"] }],
  } as unknown as Candidate;
  await files.put(mediaKey(c.id, "s0.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  reply = () =>
    message(
      JSON.stringify({
        evaluations: [{ question_number: 1, score: 8, feedback: "Good" }],
        summary: "Fine",
        strengths: [],
        concerns: [],
        proctoring_notes: [],
      }),
    );
  try {
    const ev = await ai.evaluateInterview(c);
    assert.equal(sent[0].body.output_config.effort, "high");
    assert.ok(sent[0].body.messages[0].content.some((b: { type: string }) => b.type === "image"));
    assert.equal(ev.evaluations[0].score, 8);
    assert.equal(ev.evaluations[1].feedback, "Not graded.");
  } finally {
    await files.removePrefix(`videos/${c.id}/`);
  }
});

test("a refusal, a cut-off answer and invalid JSON each fail with a clear message", async () => {
  reply = () => message("", "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "x" } });
  await assert.rejects(ai.screenResume({ job, candidate: profile, resumePart: pdf }), /declined the request \(cyber\)/);
  reply = () => message("{", "max_tokens");
  await assert.rejects(ai.screenResume({ job, candidate: profile, resumePart: pdf }), /cut off/);
  reply = () => message("not json");
  await assert.rejects(ai.screenResume({ job, candidate: profile, resumePart: pdf }), /invalid JSON/);
});

test("a bad key or empty account explains itself, without retrying", async () => {
  reply = () => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 });
  await assert.rejects(ai.screenResume({ job, candidate: profile, resumePart: pdf }), /ANTHROPIC_API_KEY is invalid/);
  assert.equal(sent.length, 1, "401 is not retried");

  reply = () =>
    Response.json(
      { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
      { status: 400 },
    );
  await assert.rejects(ai.screenResume({ job, candidate: profile, resumePart: pdf }), /out of credit/);
});

test("key check uses the Models API and reports problems", async () => {
  reply = (req) =>
    req.url.includes("/v1/models/")
      ? Response.json({ id: "claude-opus-5", type: "model", display_name: "Claude Opus 5", created_at: "2026-01-01T00:00:00Z" })
      : message("{}");
  assert.deepEqual(await claude.claudeKeyCheck(), { ok: true, model: "Claude Opus 5" });
  assert.match(sent[0].url, /\/v1\/models\/claude-opus-5$/);

  reply = () => Response.json({ type: "error", error: { type: "authentication_error", message: "bad" } }, { status: 401 });
  const bad = await claude.claudeKeyCheck();
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : "", /invalid/);
});
