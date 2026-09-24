import { config } from "./config";
import { evaluateInterview } from "./ai";
import { computeScores } from "./scoring";
import { store } from "./store";
import type { Candidate, CandidateSummary, InterviewState } from "./types";

export function interviewState(c: Candidate): InterviewState {
  const answered = c.answers.length;
  const open = (c.status === "ready" || c.status === "in_progress") && answered < c.questions.length;
  return {
    fullName: c.fullName,
    jobTitle: c.jobTitle,
    status: c.status,
    total: c.questions.length,
    answered,
    minutesPerQuestion: config.minutesPerQuestion,
    prepSeconds: config.prepSeconds,
    // Only the current question is revealed, so candidates can't preview the rest.
    nextQuestion: open ? { index: answered, text: c.questions[answered].question } : null,
  };
}

export function toSummary(c: Candidate): CandidateSummary {
  return {
    id: c.id,
    createdAt: c.createdAt,
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    jobId: c.jobId,
    jobTitle: c.jobTitle,
    totalExperience: c.totalExperience,
    currentCTC: c.currentCTC,
    expectedCTC: c.expectedCTC,
    joiningCategory: c.joiningCategory,
    status: c.status,
    answered: c.answers.length,
    totalQuestions: c.questions.length,
    scores: c.scores ?? null,
  };
}

/** Grades a finished interview and stores the result. Never throws. */
export async function runEvaluation(id: string) {
  try {
    const c = await store.getCandidate(id);
    if (!c) return;
    const evaluation = await evaluateInterview(c);
    const scores = computeScores({
      questionScores: evaluation.evaluations.map((e) => e.score),
      joiningCategory: c.joiningCategory,
      currentCTC: c.currentCTC,
      expectedCTC: c.expectedCTC,
      job: c.jobSnapshot,
    });
    await store.updateCandidate(id, (cand) => {
      cand.evaluation = evaluation;
      cand.scores = scores;
      cand.status = "completed";
      cand.evaluatedAt = new Date().toISOString();
      delete cand.evaluationError;
    });
  } catch (err) {
    console.error(`Evaluation failed for ${id}:`, err);
    await store
      .updateCandidate(id, (cand) => {
        cand.status = "evaluation_failed";
        cand.evaluationError = err instanceof Error ? err.message : String(err);
      })
      .catch(() => {});
  }
}

/** Restarts evaluations that were interrupted by a server restart. */
export async function resumePendingEvaluations() {
  const pending = (await store.listCandidates()).filter((c) => c.status === "evaluating");
  await Promise.all(pending.map((c) => runEvaluation(c.id)));
}
