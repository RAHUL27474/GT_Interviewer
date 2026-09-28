/**
 * The exact words a candidate is shown after Round 1 screening.
 *
 * This lives apart from the component on purpose. What a candidate is told is a
 * policy decision with real consequences, not decoration, so it belongs in one
 * importable place that a test can read without pulling in React and Next.
 *
 * Two things are deliberately absent, and the reasons matter more than the copy:
 *
 * 1. No score, and no hint of one. "You were close to the shortlist mark" tells a
 *    candidate that a cutoff exists, roughly where they fell against it, and
 *    invites an appeal about a number they were never shown. They learn nothing
 *    they can act on, and HR inherits the argument.
 *
 * 2. No rejection. "Your resume did not reach the shortlist" presents an
 *    automated decision as settled at the moment the whole design says a person
 *    reviews every applicant. A candidate who is told they missed out stops
 *    waiting for the human who was always going to see it.
 *
 * So the two held states share one message. The real distinction, and the score
 * behind it, stay on the HR dashboard where they belong. Sharing the object
 * rather than repeating two identical strings is what stops them drifting apart
 * the next time one of them is edited.
 */
import type { ScreeningStatus } from "./types";

export interface OutcomeCopy {
  heading: string;
  body: string;
  pill: string;
  tone: "warn" | "neutral";
}

/** Shown whenever screening did not advance the candidate to the interview. */
export const UNDER_REVIEW: OutcomeCopy = {
  heading: "Your application is with the hiring team",
  body: "Your application is under review by the hiring team. Someone will look at it personally, and there is nothing you need to do right now.",
  pill: "Under review",
  tone: "neutral",
};

export const OUTCOME_COPY: Record<ScreeningStatus, OutcomeCopy> = {
  SHORTLISTED: {
    heading: "Your resume has been shortlisted",
    body: "It matched the role closely enough to move forward, so your video interview is being prepared now.",
    pill: "Shortlisted",
    tone: "neutral",
  },
  HR_REVIEW: UNDER_REVIEW,
  NOT_SHORTLISTED: UNDER_REVIEW,
};

/** Shown when screening could not run at all. Also a hold, never a rejection. */
export const SCREENING_ERROR_COPY: OutcomeCopy = {
  heading: "Your application is with the hiring team",
  body: "We could not complete the automated screening, so your application has been sent to the hiring team instead. You do not need to do anything further right now.",
  pill: "Under review",
  tone: "neutral",
};

/** Shown while the model is still working, before there is any outcome to report. */
export const SCREENING_PENDING_COPY = {
  heading: "Your resume has been submitted",
  body: "Your resume is being assessed against the role. If it is shortlisted, you will continue straight to the video interview.",
} as const;

/**
 * Everything a held candidate is told, decided on the server.
 *
 * Resolving the copy here rather than in the client component is what keeps the
 * internal `ScreeningStatus` label out of the page source. "NOT_SHORTLISTED" in
 * the RSC payload is as much of a disclosure to a candidate reading the HTML as
 * a badge would be on screen, and it is the one thing the copy above exists to
 * withhold — a person, not a number, decides, and telling them otherwise starts
 * an argument HR then has to have.
 *
 * Returns null while screening is still running, which is the only case where
 * the candidate has no outcome yet.
 */
export function heldCandidateCopy(candidate: {
  status: "awaiting_screening" | "screening";
  screeningError?: string;
  resumeScreening?: { status: ScreeningStatus } | undefined;
}): OutcomeCopy | null {
  if (candidate.status === "screening") return null;
  if (candidate.screeningError) return SCREENING_ERROR_COPY;
  // A held candidate always has a report. Falling back to the same hold copy
  // rather than to null means an unexpected record shows "with the hiring team"
  // instead of an empty card.
  return candidate.resumeScreening ? OUTCOME_COPY[candidate.resumeScreening.status] : UNDER_REVIEW;
}
