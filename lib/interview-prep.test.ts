/**
 * A shortlisted candidate must reach the interview even when the AI provider cannot
 * write the questions.
 *
 * Regression test for a real demotion. Question generation is the last step of the
 * Round 1 gate and the only one still calling a third-party model. A provider-side
 * schema error (seen for real: "Groq API error (400): Failed to validate JSON") threw
 * out of generateQuestions, and the catch in lib/screening.ts turned that into
 * markScreeningFailed - so a candidate who had scored 79, comfortably over the 75
 * threshold, was moved to awaiting_screening, shown "under review", and queued for HR
 * over a failure that had nothing to do with their resume. The stored report still said
 * SHORTLISTED @ 79 while the status said otherwise.
 *
 * The tests below force the provider to fail and assert the candidate still ends up
 * ready, with a usable question set. Run it on its own with:
 *   node --env-file-if-exists=.env --import tsx lib/interview-prep.test.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fallbackQuestions } from "./ai/fallback";
import { config } from "./config";
import { prepareQuestionsAndMarkReady } from "./interview-prep";
import { store } from "./store";
import { writeStoredObject } from "./object-storage";
import type { Candidate } from "./types";
import { assert, suite } from "./test-harness";

const { test, done } = suite("interview prep");

const CANDIDATES_FILE = path.join(process.cwd(), "data", "candidates.json");
const FIXTURE_ID = "prep-selftest";
const FIXTURE_STORED_AS = `${FIXTURE_ID}.txt`;

const FIXTURE_RESUME = `PRIYA SHARMA
Full Stack Web Developer
TECHNICAL SKILLS
Frontend: JavaScript, TypeScript, React, Next.js, HTML5, CSS3
Backend: Node.js, Express, PostgreSQL, MySQL, REST APIs
Cloud: AWS, Docker, Linux, Nginx, Git
EXPERIENCE
Senior Full Stack Web Developer | Northwind Digital June 2023 - Present
- Built 14 responsive websites with React and Next.js.
EDUCATION
Bachelor of Science in Computer Science, 2020
`;

const JD = `We are hiring a Full Stack Web Developer to build and maintain customer-facing websites.

Responsibilities:
- Build responsive web pages and features using React / Next.js
- Develop REST APIs in Node.js (Express) or PHP (Laravel)
- Integrate third-party services such as payment gateways and CRMs
- Improve site speed, Core Web Vitals and technical SEO

Requirements:
- 2-5 years of professional web development experience
- Strong JavaScript/TypeScript, HTML, CSS
- Experience with MySQL or PostgreSQL and schema design
- Familiarity with cloud hosting, Linux and Nginx
`;

const JOB = {
  title: "Full Stack Web Developer",
  description: JD,
  salaryMin: null,
  salaryMax: null,
};

function candidate(): Candidate {
  return {
    id: FIXTURE_ID,
    createdAt: new Date().toISOString(),
    fullName: "Priya Sharma",
    email: "priya@prep-selftest.invalid",
    phone: "+1 555 0102834",
    jobId: "prep-selftest",
    jobTitle: JOB.title,
    jobSnapshot: JOB,
    totalExperience: 5,
    currentLocation: "Austin, TX",
    linkedin: "",
    currentCTC: 0,
    expectedCTC: 1200000,
    joiningCategory: "30_days",
    resume: { fileName: "resume.txt", storedAs: FIXTURE_STORED_AS },
    profileComplete: true,
    // `screening` is the state a candidate is in when the gate has just passed and
    // the questions are about to be written.
    status: "screening",
    questions: [],
    answers: [],
    proctoring: { events: [] },
  };
}

/** Force generateQuestions to fail, by making the provider a real one that has no key. */
function breakTheProvider(): () => void {
  const original = config.aiProvider;
  // "claude" with no key throws inside claudeStructured. Mock short-circuits before
  // the call, so it cannot exercise the failure path.
  (config as { aiProvider: string }).aiProvider = "claude";
  return () => {
    (config as { aiProvider: string }).aiProvider = original;
  };
}

async function main(): Promise<void> {
  if (config.databaseUrl) {
    console.log("  skip  DATABASE_URL is set; not seeding a throwaway candidate into a real database");
    done();
    return;
  }

  console.log("\n1. The deterministic question set");
  const fallback = fallbackQuestions(JOB, 6);
  await test("produces exactly the requested number of questions", () =>
    assert.equal(fallback.length, 6),
  );
  await test("every question has non-empty text", () => {
    for (const q of fallback) assert.ok(q.question.trim().length > 20, q.question);
  });
  await test("every question has a focus and a rubric", () => {
    for (const q of fallback) {
      assert.ok(q.focus.trim().length > 0, "focus must be set");
      assert.ok(q.expected_points.length >= 3, `rubric too thin: ${q.expected_points.length}`);
    }
  });
  await test("based_on is one of the two allowed values", () => {
    for (const q of fallback) assert.ok(q.based_on === "job_description" || q.based_on === "resume");
  });
  await test("section headings never become questions", () => {
    for (const q of fallback) {
      assert.ok(!/responsibilities:/i.test(q.question), q.question);
      assert.ok(!/^requirements:/i.test(q.question), q.question);
    }
  });
  await test("the opening paragraph is not read aloud as a question", () => {
    for (const q of fallback) {
      assert.ok(!/we are hiring/i.test(q.question), q.question);
    }
  });
  await test("no test-mode marker leaks into a real interview", () => {
    // The single most damaging thing to get wrong here: reusing lib/ai/mock.ts as-is
    // would label a real candidate's interview "[Test mode]" in the grader's rubric.
    for (const q of fallback) {
      assert.ok(!/\[test mode\]/i.test(q.question), q.question);
      for (const point of q.expected_points) assert.ok(!/\[test mode\]/i.test(point), point);
    }
  });
  await test("real JD content is used, not filler", () =>
    assert.ok(
      fallback.some((q) => /React|Next\.js|REST|responsive/i.test(q.question)),
      "expected at least one question drawn from the JD",
    ),
  );

  console.log("\n2. A provider failure no longer demotes a shortlisted candidate");
  const backup = await fs.readFile(CANDIDATES_FILE, "utf8").catch(() => null);
  const restoreProvider = breakTheProvider();
  try {
    await writeStoredObject(`resumes/${FIXTURE_STORED_AS}`, Buffer.from(FIXTURE_RESUME));
    await store.addCandidate(candidate());

    let result: Candidate | null = null;
    let thrown: unknown = null;
    try {
      result = await prepareQuestionsAndMarkReady(FIXTURE_ID, "screening");
    } catch (error) {
      thrown = error;
    }

    await test("the call does not throw", () => assert.equal(thrown, null, String(thrown)));
    await test("the candidate reaches 'ready'", () =>
      assert.equal(result?.status, "ready", `status was ${result?.status}`),
    );
    await test("they get a full question set", () =>
      assert.equal(result?.questions.length, 6, `got ${result?.questions.length} questions`),
    );
    await test("the fallback is flagged for HR", () =>
      assert.equal(result?.questionsFallback, true),
    );
    await test("no screening error is left behind", () => assert.equal(result?.screeningError, undefined));

    // Read back from disk, not from the returned object: the next reader of this
    // candidate is a fresh request, not this function's return value.
    const stored = await store.getCandidate(FIXTURE_ID);
    await test("the record on disk is 'ready' too", () =>
      assert.equal(stored?.status, "ready", `status was ${stored?.status}`),
    );
    await test("and the questions survived the write", () => assert.equal(stored?.questions.length, 6));
  } finally {
    restoreProvider();
    if (backup === null) await fs.rm(CANDIDATES_FILE, { force: true });
    else await fs.writeFile(CANDIDATES_FILE, backup, "utf8");
  }

  done();
}

main().catch((error) => {
  console.error("\nTest run crashed:", error);
  process.exit(1);
});
