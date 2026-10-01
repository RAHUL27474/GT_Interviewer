import crypto from "node:crypto";
import path from "node:path";
import { inviteState, startDeadline } from "./invite-state";
import { evaluateInterview, generateQuestions, resumeToPart, serverTranscripts } from "./ai";
import { config } from "./config";
import { notifyGraded } from "./email";
import { HttpError } from "./http";
import { logger, since, who } from "./log";
import { computeIntegrity } from "./proctoring";
import { computeScores } from "./scoring";
import { directUploads, files, mediaPrefix, resumeKey } from "./files";
import { store } from "./store";
import type { Candidate, CandidateSummary, Evaluation, InterviewState } from "./types";

const log = logger("interview");
const elog = logger("grading");

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
    interrupted: Boolean(c.interruption),
    interruptionReason: c.interruption?.reason ?? null,
    hrContact: config.hrContact,
    maxWarnings: config.maxWarnings,
    awayGraceSeconds: config.awayGraceSeconds,
    maxLookAwayWarnings: config.maxLookAwayWarnings,
    secondPersonGraceSeconds: config.secondPersonGraceSeconds,
    serverTranscription: config.speechToText !== "off",
    startBy: startDeadline(c),
    directUpload: directUploads,
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
    interrupted: Boolean(c.interruption),
    integrity: computeIntegrity(c.proctoring.events),
    invite: inviteState(c),
    screening: c.screening ? { score: c.screening.score, decision: c.screening.decision } : null,
  };
}

/** Throws unless `sessionId` is the live session of an in-progress interview. Updates lastSeenAt. */
export function assertActiveSession(c: Candidate, sessionId: unknown) {
  if (c.interruption || c.status !== "in_progress") throw new HttpError(409, "This interview is no longer active.");
  if (!c.sessionId || sessionId !== c.sessionId) throw new HttpError(409, "This interview is open in another window.");
  c.lastSeenAt = new Date().toISOString();
}

/**
 * Ends an in-progress interview early and submits what was answered.
 * Returns true if this call interrupted it (false if it was not in progress).
 */
export async function interruptInterview(id: string, reason: string): Promise<boolean> {
  let interrupted = false;
  const updated = await store.updateCandidate(id, (c) => {
    if (c.status !== "in_progress") return;
    const now = new Date().toISOString();
    c.interruption = { at: now, reason, answeredCount: c.answers.length };
    c.completedAt = now;
    c.status = "evaluating";
    delete c.sessionId;
    interrupted = true;
  });
  if (interrupted && updated) {
    log.warn(`${who(updated)} interrupted after ${updated.answers.length}/${updated.questions.length} answers: ${reason}`);
  }
  return interrupted;
}

/** Auto-submits in-progress interviews whose browser stopped sending heartbeats (closed, crashed, offline). */
export async function sweepStaleInterviews() {
  const cutoff = Date.now() - config.heartbeatTimeoutSec * 1000;
  const stale = (await store.listCandidatesByStatus("in_progress")).filter(
    (c) => new Date(c.lastSeenAt ?? c.startedAt ?? 0).getTime() < cutoff,
  );
  for (const c of stale) {
    if (await interruptInterview(c.id, "Connection lost or the interview window was closed")) await runEvaluation(c.id);
  }
}

const UNANSWERED_FEEDBACK = "Not answered: the interview was interrupted before this question.";

/** Grades a finished (or interrupted) interview and stores the result. Never throws. */
export async function runEvaluation(id: string) {
  const start = Date.now();
  try {
    let c = await store.getCandidate(id);
    if (!c) return;
    elog.info(`${who(c)}: grading ${c.answers.length}/${c.questions.length} answers...`);

    const source = config.speechToText === "gemini" ? "gemini" : "whisper";
    await serverTranscripts(c, async (i, text) => {
      await store.updateCandidate(id, (cand) => {
        const a = cand.answers[i];
        if (!a) return;
        if (text) {
          a.browserTranscript ??= a.transcript;
          a.transcript = text;
          a.transcriptSource = source;
        } else {
          a.transcriptSource = "browser";
        }
      });
    });
    const updated = await store.getCandidate(id);
    if (!updated) return;
    c = updated;

    let evaluation: Evaluation;
    if (c.answers.length === 0) {
      // Nothing to grade; skip the AI call.
      evaluation = {
        evaluations: c.questions.map(() => ({ score: 0, feedback: UNANSWERED_FEEDBACK })),
        summary: "The interview was interrupted before any answer was submitted.",
        strengths: [],
        concerns: [],
        proctoringNotes: [],
      };
    } else {
      evaluation = await evaluateInterview(c);
      // Unanswered questions always score 0, whatever the AI returned.
      evaluation.evaluations = evaluation.evaluations.map((e, i) =>
        i < c.answers.length ? e : { score: 0, feedback: UNANSWERED_FEEDBACK },
      );
    }

    const scores = computeScores({
      questionScores: evaluation.evaluations.map((e) => e.score),
      joiningCategory: c.joiningCategory,
      currentCTC: c.currentCTC,
      expectedCTC: c.expectedCTC,
      job: c.jobSnapshot,
    });
    const graded = await store.updateCandidate(id, (cand) => {
      cand.evaluation = evaluation;
      cand.scores = scores;
      cand.status = "completed";
      cand.evaluatedAt = new Date().toISOString();
      delete cand.evaluationError;
    });
    if (graded) await notifyGraded(graded);
    const perQuestion = evaluation.evaluations.map((e) => e.score).join(", ");
    elog.info(`${who(c)}: done in ${since(start)}. Total ${scores.total} (${scores.recommendation}); answers [${perQuestion}] /10`);
    if (evaluation.proctoringNotes.length) elog.warn(`${who(c)} proctoring: ${evaluation.proctoringNotes.join("; ")}`);
  } catch (err) {
    elog.error(`Grading ${id.slice(0, 8)} failed after ${since(start)}:`, err);
    const failed = await store
      .updateCandidate(id, (cand) => {
        cand.status = "evaluation_failed";
        cand.evaluationError = err instanceof Error ? err.message : String(err);
      })
      .catch(() => null);
    if (failed) await notifyGraded(failed);
  }
}

/** When a finished interview's media will be deleted, or null if it's kept (not finished, or retention off). */
export function mediaDeletesOn(c: Candidate): Date | null {
  if (!config.mediaRetentionDays || c.mediaDeletedAt || !c.completedAt) return null;
  if (c.status !== "completed" && c.status !== "evaluation_failed") return null;
  return new Date(new Date(c.completedAt).getTime() + config.mediaRetentionDays * 86_400_000);
}

/**
 * Deletes answer videos, snapshots and screen recordings of interviews that ended more than
 * MEDIA_RETENTION_DAYS ago. Resumes, transcripts, scores and the proctoring timeline are kept.
 */
export async function purgeOldMedia() {
  const now = Date.now();
  const due = (await store.listCandidatesByStatus("completed", "evaluation_failed")).filter((c) => {
    const on = mediaDeletesOn(c);
    return on !== null && on.getTime() <= now;
  });
  for (const c of due) {
    await files.removePrefix(mediaPrefix(c.id));
    await store.updateCandidate(c.id, (cand) => {
      cand.mediaDeletedAt = new Date().toISOString();
    });
    log.info(`${who(c)}: videos and snapshots deleted (${config.mediaRetentionDays}-day retention)`);
  }
  return due.length;
}

/**
 * Restarts evaluations that were interrupted by a server restart. `olderThanMs` skips interviews that ended more
 * recently (their grading may still be running elsewhere, e.g. on another serverless instance).
 */
export async function resumePendingEvaluations(olderThanMs = 0) {
  const cutoff = Date.now() - olderThanMs;
  const pending = (await store.listCandidatesByStatus("evaluating")).filter(
    (c) => new Date(c.completedAt ?? 0).getTime() <= cutoff,
  );
  await Promise.all(pending.map((c) => runEvaluation(c.id)));
}

/**
 * HR-approved re-interview: archives the current attempt and issues fresh questions
 * (the candidate has already seen the old ones). The same interview link works again.
 */
export async function resetForReinterview(id: string, by: string) {
  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  if (!["completed", "evaluation_failed"].includes(c.status)) {
    throw new HttpError(409, "Only finished or interrupted interviews can be reset.");
  }

  const resumePart = c.resume
    ? await resumeToPart(await files.get(resumeKey(c.resume.storedAs)), path.extname(c.resume.storedAs))
    : null;
  const questions = await generateQuestions({ job: c.jobSnapshot, candidate: c, resumePart });

  const updated = await store.updateCandidate(id, (cand) => {
    (cand.attempts ??= []).push({
      archivedAt: new Date().toISOString(),
      archivedBy: by,
      questions: cand.questions,
      answers: cand.answers,
      proctoring: cand.proctoring,
      screenRecording: cand.screenRecording,
      startedAt: cand.startedAt,
      completedAt: cand.completedAt,
      interruption: cand.interruption,
      evaluation: cand.evaluation,
      scores: cand.scores,
    });
    cand.questions = questions;
    cand.answers = [];
    cand.proctoring = { events: [] };
    cand.status = "ready";
    for (const k of ["startedAt", "completedAt", "evaluatedAt", "interruption", "evaluation", "scores", "evaluationError", "sessionId", "lastSeenAt", "screenRecording", "mediaDeletedAt"] as const) {
      delete cand[k];
    }
  });
  if (!updated) throw new HttpError(404, "Candidate not found.");
  return updated;
}

export function newSessionId() {
  return crypto.randomBytes(16).toString("hex");
}
