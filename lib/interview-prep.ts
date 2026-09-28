import path from "node:path";
import { generateQuestions, resumeToPart } from "./ai";
import { fallbackQuestions } from "./ai/fallback";
import { config } from "./config";
import { HttpError } from "./http";
import { readStoredObject } from "./object-storage";
import { store } from "./store";
import type { Candidate } from "./types";

/**
 * After a resume is shortlisted: generate questions and open the interview.
 * Details are collected during registration, so only candidates registered before that
 * change (or whose record predates `profileComplete`) still land in `profile_pending`.
 */
export async function openInterviewOrWaitForDetails(candidateId: string): Promise<Candidate | null> {
  const existing = await store.getCandidate(candidateId);
  if (!existing) return null;

  if (!existing.profileComplete) {
    return store.updateCandidate(candidateId, (candidate) => {
      if (candidate.status !== "screening") return;
      candidate.questions = [];
      candidate.status = "profile_pending";
      delete candidate.screeningError;
    });
  }

  return prepareQuestionsAndMarkReady(candidateId, "screening");
}

export async function prepareQuestionsAndMarkReady(
  candidateId: string,
  expectedStatus: Candidate["status"],
): Promise<Candidate | null> {
  const existing = await store.getCandidate(candidateId);
  if (!existing) return null;
  const ext = path.extname(existing.resume.storedAs);
  const buffer = await readStoredObject(`resumes/${existing.resume.storedAs}`);

  // The resume is read once, outside the retry: it is deterministic and the most
  // expensive part, and re-reading a file for a call that already failed is waste.
  const resumePart = await resumeToPart(buffer, ext);

  // Retry once before giving up. Providers fail intermittently on structured output -
  // the same resume and job have produced both a valid question set and a schema
  // violation on the same day - so a second attempt is a genuinely different chance,
  // not a repeat of the same dice roll.
  let questions: Candidate["questions"] = [];
  for (let attempt = 1; attempt <= 2 && !questions.length; attempt++) {
    try {
      questions = await generateQuestions({
        job: existing.jobSnapshot,
        candidate: existing,
        resumePart,
      });
    } catch (error) {
      if (attempt === 2) {
        // Falling through to the deterministic set below. This is deliberately not
        // rethrown: the candidate already cleared the gate, and the question set is
        // an implementation detail of the interview they are entitled to. Throwing
        // here used to demote a SHORTLISTED candidate to the HR queue over a
        // provider-side schema error.
        console.warn(
          `[interview-prep] ${candidateId}: question generation failed on both attempts, using job-description questions.`,
          error,
        );
      } else {
        console.warn(`[interview-prep] ${candidateId}: question generation attempt 1 failed, retrying.`, error);
      }
    }
  }

  if (!questions.length) {
    questions = fallbackQuestions(existing.jobSnapshot, config.questionCount);
    // Recorded so /admin can show that this interview was not model-written. A plain
    // flag rather than a field on the report: the report describes the resume, and
    // this says something about our own pipeline instead.
    await store.updateCandidate(candidateId, (candidate) => {
      candidate.questionsFallback = true;
    });
  }

  return store.updateCandidate(candidateId, (candidate) => {
    if (candidate.status !== expectedStatus) {
      throw new HttpError(409, "Review state changed unexpectedly.");
    }
    candidate.questions = questions;
    candidate.status = "ready";
    delete candidate.screeningError;
  });
}
