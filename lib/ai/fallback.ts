// Deterministic interview questions, used when the AI provider cannot produce them.
//
// Why this exists: question generation is the last step of the Round 1 gate, and it
// is the only step still talking to a third-party model. A single bad structured-output
// response from the provider used to cost a candidate the whole auto-advance. The
// screening decision had already been made and recorded as SHORTLISTED, but a failure
// while writing the questions threw, and the catch in lib/screening.ts turned that into
// "awaiting_screening" - so someone who cleared 75 was shown "under review" and put in
// the HR queue, for a reason that has nothing to do with their resume.
//
// The gate is the promise that a strong candidate reaches the interview without a human
// in the loop. This keeps that promise when the provider misbehaves: the interview still
// happens, with questions derived from the job description rather than from the resume.
// The questions are plainer, not wrong, and a human is still free to review them in /admin.
//
// These are real interview questions, so unlike lib/ai/mock.ts they carry no "[Test mode]"
// marker. Mock questions are labelled because they are a developer affordance; a fallback
// question shown to an actual candidate must not be mistaken for one.
import type { Job, Question } from "../types";

/** Section headings in a stored JD, which are labels rather than content. */
const SECTION_HEADINGS =
  /^(responsibilities|requirements|qualifications|what you(?:'|’)?ll need|about the role|what we(?:'|’)?re looking for|nice to have)\b/i;

/**
 * The opening pitch, e.g. "We are hiring a Full Stack Web Developer to...".
 *
 * The dot is escaped on purpose. Unescaped, `.` matches any character, so the pattern
 * also matched "We are hiring" inside a body line such as "Familiarity with cloud
 * hosting" and the intro paragraph survived into the question set. It is also split
 * out from SECTION_HEADINGS because that one is anchored to the start of the line.
 */
const INTRO_PITCH = /^we(?:'|’)?(?: are| is|'re)\s/i;

/** Words too common to identify what a question is about. */
const FILLER = new Set([
  "and", "the", "with", "for", "from", "that", "this", "our", "your", "you", "are", "will",
  "have", "has", "who", "work", "working", "team", "role", "job", "years", "year", "plus",
  "using", "use", "used", "into", "over", "them", "they", "their", "able", "other", "than",
]);

/** Words that open a JD bullet, and are worth showing back to the candidate. */
function normaliseBullet(line: string): string {
  return line
    .replace(/^\s*[-*•·]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Short label for what a question tests: its most distinctive words. */
function focusOf(text: string, max = 4): string {
  const words = text
    .split(/[^A-Za-z0-9+#.]+/)
    .map((w) => w.replace(/[.,;:]+$/, ""))
    .filter((w) => w.length > 2 && !FILLER.has(w.toLowerCase()));
  const picked = words.slice(0, max);
  return (picked.length ? picked : words).join(" ") || "Role requirements";
}

/**
 * Split a stored JD into its content lines.
 *
 * Handles the shape these JDs actually have: a prose intro, then "Responsibilities:"
 * and "Requirements:" sections of `- ` bullets. Intro prose and headings are dropped,
 * because "tell me about: Responsibilities:" is not an interview question.
 */
function jdLines(description: string): string[] {
  const out: string[] = [];
  for (const raw of description.split("\n")) {
    const line = normaliseBullet(raw);
    if (line.length < 15) continue;
    if (SECTION_HEADINGS.test(line)) continue;
    // The opening paragraph describes the company and the role in prose. It is not a
    // discrete requirement, and reading it aloud as a question is clumsy.
    if (INTRO_PITCH.test(line)) continue;
    if (out.includes(line)) continue;
    out.push(line);
  }
  return out;
}

/** Rubric for a JD-derived question. Grader-only; never shown to the candidate. */
function expectedPointsFor(line: string, role: string): string[] {
  const keywords = focusOf(line, 6);
  return [
    `A concrete example of: ${keywords}`,
    "Their own role in it, not just the team's",
    "Tools or method they reached for",
    "A measurable result, or a clear trade-off they made",
    `How it applies to a ${role} position`,
  ];
}

/**
 * Build a full question set from the job description alone.
 *
 * Deterministic, offline and instant, so it is a safe last resort. The resume is not
 * read, which is the one real limitation: the questions probe the role rather than the
 * candidate. That is why this is a fallback and not the default.
 */
export function fallbackQuestions(
  job: Pick<Job, "title" | "description">,
  count: number,
): Question[] {
  const questions: Question[] = [];

  for (const line of jdLines(job.description)) {
    if (questions.length >= count) break;
    questions.push({
      question: `The job description calls for: "${line}". Talk me through how you would handle it, or how you have handled something similar.`,
      focus: focusOf(line),
      based_on: "job_description",
      expected_points: expectedPointsFor(line, job.title),
    });
  }

  const opening: Question[] = [
    {
      question: `Walk me through the part of your resume that is most relevant to a ${job.title} role.`,
      focus: "Relevant experience",
      based_on: "resume",
      expected_points: [
        "A specific role or project, with dates",
        "Their own contribution, clearly separated from the team's",
        "Why it is relevant to this job",
        "An outcome they can point to",
      ],
    },
    {
      question: `Tell me about a hard problem you solved on a previous job, and what you would do differently now.`,
      focus: "Problem solving",
      based_on: "resume",
      expected_points: [
        "The actual difficulty, stated plainly",
        "How they narrowed it down",
        "What they tried that did not work",
        "What they learned and would change",
      ],
    },
    {
      question: `What would you want to know, or what would you need, to do this job well in your first three months?`,
      focus: "Preparedness and questions",
      based_on: "job_description",
      expected_points: [
        "Something specific to this role, not generic",
        "A realistic view of the first stretch",
        "Willingness to ask rather than assume",
      ],
    },
    {
      question: `Why are you interested in a ${job.title} position, and what has drawn you to this kind of work?`,
      focus: "Motivation",
      based_on: "resume",
      expected_points: [
        "A reason tied to the actual role or the work",
        "Evidence from their history that it fits",
        "Realistic rather than purely flattering",
      ],
    },
  ];
  for (const q of opening) {
    if (questions.length >= count) break;
    questions.push(q);
  }

  return questions.slice(0, count);
}
