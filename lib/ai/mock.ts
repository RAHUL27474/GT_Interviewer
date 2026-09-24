// Test mode with no AI provider: builds questions from the JD's bullet points and scores answers
// with a simple length/keyword heuristic. Everything it produces is labelled "[Test mode]".
import type { Candidate, Evaluation, Job, Question } from "../types";

const TEST = "[Test mode]";
// Words from the question template itself, which shouldn't count as keyword matches.
const STOPWORDS = new Set(["role", "involves", "tell", "have", "done", "this", "before", "would", "approach", "with", "your", "that", "from", "about", "what", "which", "their", "them", "they", "into", "through", "walk", "experience"]);

export function mockQuestions(job: Pick<Job, "title" | "description">, count: number): Question[] {
  const bullets = job.description
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l, i, all) => l.length > 15 && l !== all[i - 1] && !l.endsWith(":"))
    .slice(0, count);

  const questions: Question[] = bullets.map((line) => ({
    question: `The role involves: "${line}". Tell me how you have done this before, or how you would approach it.`,
    focus: line.split(/\s+/).slice(0, 4).join(" "),
    based_on: "job_description",
    expected_points: [`${TEST} Concrete example related to: ${line}`, "Tools or methods used", "Measurable result"],
  }));

  const generic = [
    `Walk me through the experience on your resume that is most relevant to the ${job.title} role.`,
    `Tell me about a difficult problem you solved at work and what you learned from it.`,
    `Why are you interested in this ${job.title} position?`,
  ];
  for (const q of generic) {
    if (questions.length >= count) break;
    questions.push({
      question: q,
      focus: "Relevant experience",
      based_on: "resume",
      expected_points: [`${TEST} Specific, relevant example`, "Clear personal contribution", "Outcome"],
    });
  }
  return questions.slice(0, count);
}

export function mockEvaluation(candidate: Candidate): Evaluation {
  const evaluations = candidate.questions.map((q, i) => {
    const words = (candidate.answers[i]?.transcript ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return { score: 0, feedback: `${TEST} No speech detected.` };
    // Up to 7 points for length (~20 words per point), up to 3 for mentioning the question's focus words.
    const keywords = new Set(
      q.question
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
    );
    const hits = [...keywords].filter((w) => words.some((x) => x.startsWith(w))).length;
    const score = Math.min(10, Math.min(7, Math.round(words.length / 20)) + Math.min(3, hits));
    return { score, feedback: `${TEST} Heuristic score: ${words.length} words, ${hits} keyword matches. Not an AI evaluation.` };
  });
  return {
    evaluations,
    summary: `${TEST} These scores come from answer length and keywords only, not AI. Add an AI API key for real grading.`,
    strengths: [],
    concerns: [],
    proctoringNotes: [],
  };
}
