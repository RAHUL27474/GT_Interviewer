// Resume screening: turns the AI's resume rating and the job's rules into a decision (interview, reject, or HR review).
// Shared by the server and tests; no Node imports.
import type { ResumeRating } from "./ai";
import type { CandidateProfile, Job, JobScreening, Screening } from "./types";

export const DEFAULT_SCREENING: JobScreening = { passMark: 60, minExperience: null };

/** The job's rules, or the defaults (RESUME_PASS_MARK, no experience minimum). */
export function screeningRules(job: Pick<Job, "screening">, defaultPassMark = DEFAULT_SCREENING.passMark): JobScreening {
  return job.screening ?? { passMark: defaultPassMark, minExperience: null };
}

/**
 * The decision for one applicant. A resume that couldn't be read goes to HR review rather than rejection, so a
 * sharing mistake doesn't cost a good applicant the interview.
 */
export function decide(
  rating: ResumeRating | null,
  profile: Pick<CandidateProfile, "totalExperience">,
  rules: JobScreening,
  resumeProblem?: string,
): Screening {
  const base = {
    score: rating?.score ?? null,
    summary: rating?.summary ?? "",
    strengths: rating?.strengths ?? [],
    gaps: rating?.gaps ?? [],
    at: new Date().toISOString(),
  };
  if (rules.minExperience !== null && profile.totalExperience < rules.minExperience) {
    return {
      ...base,
      decision: "rejected",
      reasons: [`${profile.totalExperience} years of experience; this job needs at least ${rules.minExperience}.`],
    };
  }
  if (!rating) {
    return {
      ...base,
      decision: "review",
      reasons: [`The resume couldn't be read${resumeProblem ? `: ${resumeProblem}` : "."} HR needs to decide.`],
    };
  }
  if (rating.score < rules.passMark) {
    return { ...base, decision: "rejected", reasons: [`Resume rated ${rating.score}/100, below the pass mark of ${rules.passMark}.`] };
  }
  return { ...base, decision: "selected", reasons: [`Resume rated ${rating.score}/100 (pass mark ${rules.passMark}).`] };
}
