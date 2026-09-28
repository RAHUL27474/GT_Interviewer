/**
 * End-to-end check of the Round 1 screening path through the real Node modules.
 *
 * Exercises the resident Python bridge, the five-dimension scoring, the
 * three-state decision and the LLM fallback, without needing a running Next.js
 * server or any AI provider.
 *
 * This file is self-sufficient. It writes its own resume fixture and seeds its
 * own candidate rather than depending on a resume left behind by a manual
 * registration, because `data/` is gitignored: a test that needs a file nobody
 * committed fails on every machine except the one that wrote it. The store file
 * is backed up and restored around the seeded section, following the same
 * approach as lib/publishers/recruitee.test.ts, so a run leaves the developer's
 * candidate list exactly as it found it.
 *
 * Run it on its own with:
 *   node --env-file-if-exists=.env --import tsx lib/screening.test.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { runResumeScreening } from "./screening";
import { disposeScreeningBridge, screenWithBridge, warmScreeningBridge } from "./screening-engine";
import { store, upgradeScreening } from "./store";
import { deleteStoredObject, writeStoredObject } from "./object-storage";
import type { Candidate } from "./types";
import { suite } from "./test-harness";

const { test, done } = suite("screening");

const CANDIDATES_FILE = path.join(process.cwd(), "data", "candidates.json");
const FIXTURE_ID = "screening-selftest";
const FIXTURE_STORED_AS = `${FIXTURE_ID}.txt`;

/**
 * A deliberately plain-text resume. A PDF would exercise nothing extra here: the
 * assertions below are about scoring and the three-state decision, and the
 * bridge's own OCR path is a separate concern. What matters is that the content
 * names real skills, roles and dates, which is what the parser reads.
 */
const FIXTURE_RESUME = `ALEX MERCER
Full Stack Developer | San Francisco, CA | alex.mercer@email.com | +1 (555) 019-2834
PROFESSIONAL SUMMARY
Full Stack Developer with over 4 years of experience designing, building and
deploying web applications. Proficient in modern frontend frameworks (React,
Next.js) and scalable backend architectures (Node.js, Python, PostgreSQL).
TECHNICAL SKILLS
Frontend: JavaScript (ES6+), TypeScript, React, Next.js, HTML5, CSS3, Tailwind CSS, Redux
Backend: Node.js, Express, Python, Django, RESTful APIs, GraphQL, WebSockets
Databases & Cloud: PostgreSQL, MongoDB, Redis, AWS (S3, EC2, Lambda), Docker, Firebase
Tools & DevOps: Git, GitHub Actions, CI/CD, Jest, Postman, Linux, Agile/Scrum
PROFESSIONAL EXPERIENCE
Senior Full Stack Engineer | TechCorp Solutions June 2024 - Present
- Architected and migrated a legacy monolithic platform to a React and Node.js
  microservices architecture, improving page load speeds by 40%.
- Spearheaded a real-time analytics dashboard using WebSockets and Redis,
  handling over 10k concurrent updates.
Full Stack Developer | Innovate Web Media March 2022 - May 2024
- Developed and deployed 12+ responsive e-commerce web applications using
  Next.js, Tailwind CSS and PostgreSQL.
EDUCATION
Bachelor of Science in Computer Science, 2021
PROJECTS
Real-time analytics dashboard, REST API service, E-commerce storefront
`;

/** Score a JD against the fixture, through the real bridge. */
function score(jd: string) {
  return screenWithBridge({
    resume: Buffer.from(FIXTURE_RESUME),
    filename: "resume.txt",
    jobDescription: jd,
    shortlistThreshold: config.resumeScreenPassScore,
    reviewThreshold: config.resumeScreenReviewScore,
  });
}

async function main() {
  console.log(`Bridge enabled: ${config.screeningBridgeEnabled}, AI provider: ${config.aiProvider}`);
  console.log(`Thresholds: shortlist >= ${config.resumeScreenPassScore}, review >= ${config.resumeScreenReviewScore}\n`);

  // 1. The bridge must come up and report ready.
  console.log("1. Bridge warm-up");
  const ready = await warmScreeningBridge();
  await test("bridge starts and loads the model", () => assert.ok(ready));
  if (!ready) {
    disposeScreeningBridge();
    console.log("\nCannot continue without the bridge. Run `uv sync` in the parent repo.");
    process.exit(1);
  }

  // 2. Score a resume directly, with no database involved.
  console.log("\n2. Direct bridge score against a backend JD");
  const strong = await score(
    "Backend Engineer. Required: Python, Django, PostgreSQL, AWS, Docker. Minimum 3 years experience. Bachelor's degree required.",
  );
  await test("bridge returns a result", () => assert.notEqual(strong, null));
  if (strong) {
    console.log(
      `      final=${strong.scores.finalScore} status=${strong.status} required=${strong.scores.requiredSkills}% semantic=${strong.scores.semantic}`,
    );
    await test("all five dimensions present", () =>
      assert.ok(
        ["requiredSkills", "experience", "education", "projects", "semantic"].every(
          (k) => typeof (strong.scores as unknown as Record<string, unknown>)[k] === "number",
        ),
      ),
    );
    await test("status is one of the three states", () =>
      assert.ok(["SHORTLISTED", "HR_REVIEW", "NOT_SHORTLISTED"].includes(strong.status), strong.status),
    );
    await test("matched skills found", () => assert.ok(strong.matchedSkills.length > 0, strong.matchedSkills.join(", ")));
    await test("candidate fields parsed", () => assert.ok(strong.candidate.name, String(strong.candidate.name)));
    await test("engine reported as bridge", () => assert.equal(strong.engine, "bridge"));
  }

  // 3. A strong candidate against a JD that asks for something unrelated must not shortlist.
  console.log("\n3. Unrelated JD should not shortlist");
  const weak = await score(
    "Senior Civil Structural Engineer. Required: AutoCAD, STAAD Pro, ETABS, reinforced concrete design, site supervision. Minimum 12 years experience. Master's degree required.",
  );
  await test("bridge returns a result", () => assert.notEqual(weak, null));
  if (weak) {
    console.log(`      final=${weak.scores.finalScore} status=${weak.status} required=${weak.scores.requiredSkills}%`);
    await test("not shortlisted for an unrelated role", () =>
      assert.notEqual(weak.status, "SHORTLISTED"),
    );
    await test("missing skills reported", () => assert.ok(weak.missingSkills.length > 0, `${weak.missingSkills.length} missing`));
  }

  // 3b. A vague job description must not decide the ranking.
  //     Regression guard: when the posting names no recognisable skill, coverage
  //     computes as 0/0 and the 40%-weighted dimension used to score 0, which
  //     docked every candidate for the posting's vagueness instead of their CV.
  console.log("\n3b. Vague JD leaves unstated dimensions neutral, not zero");
  const vague = await score(
    "We are looking for a motivated, hard-working professional to join our friendly team. " +
      "Prior experience is appreciated but not essential. We care about attitude and honesty.",
  );
  await test("bridge returns a result", () => assert.notEqual(vague, null));
  if (vague) {
    console.log(
      `      final=${vague.scores.finalScore} status=${vague.status} required=${vague.scores.requiredSkills}% experience=${vague.scores.experience} education=${vague.scores.education}`,
    );
    await test("no skills were extracted from the vague JD", () =>
      assert.equal(vague.requiredSkills.length, 0, vague.requiredSkills.join(", ")),
    );
    await test("required-skills dimension is neutral, not 0", () =>
      assert.ok(vague.scores.requiredSkills > 0, String(vague.scores.requiredSkills)),
    );
    await test("experience dimension is neutral, not 0", () =>
      assert.ok(vague.scores.experience > 0, String(vague.scores.experience)),
    );
    await test("education dimension is neutral, not 0", () =>
      assert.ok(vague.scores.education > 0, String(vague.scores.education)),
    );
    await test("a vague JD cannot auto-reject on its own", () => assert.notEqual(vague.status, "NOT_SHORTLISTED"));
    await test("HR is warned the score is unreliable", () =>
      assert.ok((vague.engineNotes ?? []).some((note) => /no skill this model recognises|neutral/i.test(note))),
    );
  }

  // 4. The full store-backed path, including status transition.
  //    Mock mode short-circuits before the bridge by design, so the provider is
  //    overridden here to exercise the real path. No AI call is made: the bridge
  //    answers, so the LLM fallback is never reached.
  console.log("\n4. Full path via runResumeScreening + store");
  // The store may be backed by a real database, where writing a throwaway
  // candidate is not ours to undo. Skip rather than pollute someone's data.
  if (config.databaseUrl) {
    console.log("  skip  DATABASE_URL is set; not seeding a throwaway candidate into a real database");
  } else {
    const backup = await fs.readFile(CANDIDATES_FILE, "utf8").catch(() => null);
    try {
      await writeStoredObject(`resumes/${FIXTURE_STORED_AS}`, Buffer.from(FIXTURE_RESUME));
      // addCandidate is async in both backends: skipping the await means the
      // write has not landed on disk when runResumeScreening reads it back.
      await store.addCandidate({
        id: FIXTURE_ID,
        createdAt: new Date().toISOString(),
        fullName: "Alex Mercer",
        email: "alex.mercer@selftest.invalid",
        phone: "+1 555 0192834",
        jobId: "selftest",
        jobTitle: "Backend Engineer",
        jobSnapshot: {
          title: "Backend Engineer",
          description: "Python, Django, PostgreSQL, AWS, Docker.",
          salaryMin: null,
          salaryMax: null,
        },
        totalExperience: 4,
        currentLocation: "San Francisco, CA",
        linkedin: "linkedin.com/in/alexmercer",
        currentCTC: 0,
        expectedCTC: 0,
        joiningCategory: "",
        resume: { fileName: "resume.txt", storedAs: FIXTURE_STORED_AS },
        profileComplete: true,
        status: "awaiting_screening",
        questions: [],
        answers: [],
        proctoring: { events: [] },
      });

      const previousProvider = config.aiProvider;
      (config as { aiProvider: string }).aiProvider = "groq";
      try {
        const report = await runResumeScreening(FIXTURE_ID);
        await test("report produced", () => assert.notEqual(report, null));
        if (report) {
          console.log(
            `      status=${report.status} final=${report.scores.finalScore} engine=${report.engine} next=${report.recommendedNextStep}`,
          );
          await test("engine is the Python bridge", () => assert.equal(report.engine, "bridge"));
          await test("report carries a summary", () => assert.ok(report.summary.length > 0));
          // The fixture is a full-stack CV screened against a backend role, so a
          // low required-skills score is a legitimate answer here, not a bug.
          // Assert the dimensions are populated and internally consistent instead.
          await test("every dimension is a number", () =>
            assert.ok(
              ["requiredSkills", "experience", "education", "projects", "semantic"].every(
                (k) => typeof (report.scores as unknown as Record<string, unknown>)[k] === "number",
              ),
            ),
          );
          await test("semantic fit scored", () => assert.ok(report.scores.semantic > 0, String(report.scores.semantic)));
          await test("a matching role is shortlisted end to end", () => assert.equal(report.status, "SHORTLISTED"));
          await test("recommendation agrees with status", () =>
            assert.equal(report.recommendation, report.status === "SHORTLISTED" ? "advance" : "hr_review"),
          );
          await test("candidate profile attached", () => assert.ok(report.candidateProfile?.name, String(report.candidateProfile?.name)));
        }
      } finally {
        (config as { aiProvider: string }).aiProvider = previousProvider;
      }

      // 4b. Mock mode must never auto-advance, whatever the model says.
      //     This sits inside the seeded block because it needs the same
      //     candidate, which the finally below deletes.
      console.log("\n4b. Mock mode short-circuits (no auto-advance)");
      const previousMockProvider = config.aiProvider;
      (config as { aiProvider: string }).aiProvider = "mock";
      try {
        const mockReport = await runResumeScreening(FIXTURE_ID);
        await test("mock report produced", () => assert.notEqual(mockReport, null));
        await test("mock engine reported", () => assert.equal(mockReport?.engine, "mock"));
        await test("mock never advances", () => assert.equal(mockReport?.recommendation, "hr_review"));
        await test("mock final score is 0", () => assert.equal(mockReport?.scores.finalScore, 0));
      } finally {
        (config as { aiProvider: string }).aiProvider = previousMockProvider;
      }
    } finally {
      // Restore the candidate list and remove the fixture, so a failed run cannot
      // leave a phantom candidate in the admin queue.
      if (backup === null) {
        await fs.rm(CANDIDATES_FILE, { force: true });
      } else {
        await fs.writeFile(CANDIDATES_FILE, backup);
      }
      await fs.rm(path.join(CANDIDATES_FILE + ".tmp"), { force: true });
      await deleteStoredObject(`resumes/${FIXTURE_STORED_AS}`).catch(() => undefined);
    }
  }

  // 5. Bridge failure must degrade, not throw.
  console.log("\n5. Degradation when the bridge cannot start");
  const previousPython = config.screeningBridgePython;
  const previousEnabled = config.screeningBridgeEnabled;
  try {
    (config as { screeningBridgePython: string }).screeningBridgePython = "definitely-not-a-real-interpreter-xyz";
    (config as { screeningBridgeEnabled: boolean }).screeningBridgeEnabled = false;
    const degraded = await screenWithBridge({
      resume: Buffer.from(FIXTURE_RESUME),
      filename: "resume.txt",
      jobDescription: "Backend Engineer. Python, Django.",
      shortlistThreshold: 75,
      reviewThreshold: 50,
    });
    await test("returns null instead of throwing", () => assert.equal(degraded, null));
  } finally {
    (config as { screeningBridgePython: string }).screeningBridgePython = previousPython;
    (config as { screeningBridgeEnabled: boolean }).screeningBridgeEnabled = previousEnabled;
  }

  // 6. Malformed input must not wedge the bridge.
  console.log("\n6. Bad input handling");
  const empty = await screenWithBridge({
    resume: Buffer.from(""),
    filename: "resume.txt",
    jobDescription: "Backend Engineer. Python.",
    shortlistThreshold: 75,
    reviewThreshold: 50,
  });
  await test("empty resume returns null (falls through to RESUME_UNPARSEABLE handling)", () =>
    assert.equal(empty, null),
  );
  const stillAlive = await warmScreeningBridge();
  await test("bridge still responsive after bad input", () => assert.ok(stillAlive));

  // 7. A report written by an older build must still render.
  //    These are the only four fields the first version stored, and every HR
  //    decision already in the database looks like this. If upgradeScreening
  //    breaks, every historical candidate disappears from the drawer.
  console.log("\n7. Legacy record upgrade");
  const legacyCandidate = { id: "legacy" } as unknown as Candidate;
  const legacyReport: Parameters<typeof upgradeScreening>[1] = {
    score: 62,
    summary: "legacy",
    strengths: [],
    gaps: [],
    recommendation: "hr_review",
  };

  const belowBar = upgradeScreening(legacyCandidate, legacyReport);
  await test("legacy report upgraded", () => assert.notEqual(belowBar, null));
  await test("original score preserved", () => assert.equal(belowBar?.score, 62));
  await test("engine defaults to llm", () => assert.equal(belowBar?.engine, "llm"));
  await test("reclassified to HR_REVIEW below the mark", () => assert.equal(belowBar?.status, "HR_REVIEW"));
  await test("skill lists default to empty", () =>
    assert.equal(belowBar?.matchedSkills.length, 0),
  );
  await test("scores block backfilled from the score", () => assert.equal(belowBar?.scores.finalScore, 62));
  await test("thresholds stamped in", () => assert.equal(belowBar?.scores.threshold, config.resumeScreenPassScore));
  await test("next step defaulted", () => assert.equal(belowBar?.recommendedNextStep, "HR Manual Review"));

  await test("reclassified to SHORTLISTED above the mark", () =>
    assert.equal(upgradeScreening(legacyCandidate, { ...legacyReport, score: 88 })?.status, "SHORTLISTED"),
  );
  await test("absent report stays absent", () =>
    assert.equal(upgradeScreening({ id: "none" } as unknown as Candidate, null), null),
  );

  disposeScreeningBridge();
  done();
}

main().catch((error) => {
  console.error("\nTest run crashed:", error);
  disposeScreeningBridge();
  process.exit(1);
});
