import path from "node:path";
import { resumeToPart, screenResume } from "./ai";
import { config } from "./config";
import { openInterviewOrWaitForDetails } from "./interview-prep";
import { readStoredObject } from "./object-storage";
import { notify } from "./notify";
import { screenWithBridge } from "./screening-engine";
import { store } from "./store";
import type {
  NotificationEvent,
  NotificationRecord,
  ResumeScreening,
  ResumeScreeningReport,
  ScreeningCandidateProfile,
  ScreeningScores,
  ScreeningStatus,
} from "./types";

/** The three states from the screening spec. Nothing is ever auto-rejected. */
function decideStatus(finalScore: number): ScreeningStatus {
  if (finalScore >= config.resumeScreenPassScore) return "SHORTLISTED";
  if (finalScore >= config.resumeScreenReviewScore) return "HR_REVIEW";
  return "NOT_SHORTLISTED";
}

function nextStepFor(status: ScreeningStatus): string {
  if (status === "SHORTLISTED") return "AI Interview";
  return "HR Manual Review";
}

function round1(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}

/** Build a full report from the LLM judge, which only returns one score. */
function reportFromLlm(assessment: ResumeScreening): ResumeScreeningReport {
  const status = decideStatus(assessment.score);
  const scores: ScreeningScores = {
    requiredSkills: 0,
    experience: 0,
    education: 0,
    projects: 0,
    semantic: 0,
    finalScore: assessment.score,
    nativeScreeningScore: null,
    semanticSimilarity: null,
    skillCoveragePercent: null,
    threshold: config.resumeScreenPassScore,
    reviewThreshold: config.resumeScreenReviewScore,
    marginToThreshold: Math.round((assessment.score - config.resumeScreenPassScore) * 10) / 10,
  };
  return {
    ...assessment,
    recommendation: status === "SHORTLISTED" ? "advance" : "hr_review",
    engine: "llm",
    status,
    scores,
    requiredSkills: [],
    matchedSkills: [],
    missingSkills: [],
    bonusSkills: [],
    recommendedNextStep: nextStepFor(status),
  };
}

function reportFromBridge(result: Awaited<ReturnType<typeof screenWithBridge>>): ResumeScreeningReport | null {
  if (!result) return null;
  const finalScore = Math.round(round1(result.scores.finalScore));
  const status = decideStatus(finalScore);
  const candidate = result.candidate as Partial<ScreeningCandidateProfile>;

  const scores: ScreeningScores = {
    requiredSkills: round1(result.scores.requiredSkills),
    experience: round1(result.scores.experience),
    education: round1(result.scores.education),
    projects: round1(result.scores.projects),
    semantic: round1(result.scores.semantic),
    finalScore,
    nativeScreeningScore: round1(result.scores.nativeScreeningScore),
    semanticSimilarity: round1(result.scores.semanticSimilarity),
    skillCoveragePercent: round1(result.scores.skillCoveragePercent),
    threshold: config.resumeScreenPassScore,
    reviewThreshold: config.resumeScreenReviewScore,
    marginToThreshold: Math.round((finalScore - config.resumeScreenPassScore) * 10) / 10,
  };

  return {
    score: finalScore,
    summary: result.summary,
    strengths: result.strengths ?? [],
    gaps: result.gaps ?? [],
    recommendation: status === "SHORTLISTED" ? "advance" : "hr_review",
    engine: "bridge",
    status,
    scores,
    requiredSkills: result.requiredSkills ?? [],
    matchedSkills: result.matchedSkills ?? [],
    missingSkills: result.missingSkills ?? [],
    bonusSkills: (result.bonusSkills ?? []).slice(0, 20),
    recommendedNextStep: result.recommendedNextStep || nextStepFor(status),
    candidateProfile: {
      name: candidate.name ?? null,
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      currentTitle: candidate.currentTitle ?? null,
      totalExperienceYears: candidate.totalExperienceYears ?? null,
      employers: candidate.employers ?? [],
      education: candidate.education ?? [],
      certifications: candidate.certifications ?? [],
      skills: (candidate.skills ?? []).slice(0, 20),
    },
    jobRequirements: result.jobRequirements,
    extractionMethod: result.extractionMethod,
    engineNotes: result.engineNotes ?? [],
  };
}

/**
 * Score a candidate's resume against the job snapshot they applied to.
 *
 * The Python model in src/resume_screening is tried first; the LLM judge is the
 * fallback so screening still works on a machine with no venv or model cached.
 * Mock mode short-circuits to a no-AI result, as before.
 */
export async function runResumeScreening(candidateId: string): Promise<ResumeScreeningReport | null> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) return null;

  if (config.aiProvider === "mock") {
    return {
      score: 0,
      summary: "Test mode is active; no AI resume assessment ran. HR review is required.",
      strengths: [],
      gaps: [],
      recommendation: "hr_review",
      engine: "mock",
      status: "HR_REVIEW",
      scores: {
        requiredSkills: 0,
        experience: 0,
        education: 0,
        projects: 0,
        semantic: 0,
        finalScore: 0,
        nativeScreeningScore: null,
        semanticSimilarity: null,
        skillCoveragePercent: null,
        threshold: config.resumeScreenPassScore,
        reviewThreshold: config.resumeScreenReviewScore,
        marginToThreshold: -config.resumeScreenPassScore,
      },
      requiredSkills: [],
      matchedSkills: [],
      missingSkills: [],
      bonusSkills: [],
      recommendedNextStep: "HR Manual Review",
    };
  }

  const ext = path.extname(candidate.resume.storedAs);
  const resume = await readStoredObject(`resumes/${candidate.resume.storedAs}`);
  const jobDescription = `${candidate.jobSnapshot.title}\n\n${candidate.jobSnapshot.description}`;

  // The bridge takes the raw file so it can OCR scanned PDFs, which this app
  // cannot do itself.
  const fromBridge = reportFromBridge(
    await screenWithBridge({
      resume,
      filename: candidate.resume.fileName || candidate.resume.storedAs,
      jobDescription,
      shortlistThreshold: config.resumeScreenPassScore,
      reviewThreshold: config.resumeScreenReviewScore,
    }),
  );
  if (fromBridge) return fromBridge;

  const assessment = await screenResume({
    job: candidate.jobSnapshot,
    resumePart: await resumeToPart(resume, ext),
  });
  return reportFromLlm(assessment);
}

export async function processResumeScreening(candidateId: string): Promise<void> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate || candidate.status !== "screening") return;

  const report = await runResumeScreening(candidateId);
  if (!report) throw new Error("Screening produced no result.");
  // Mock mode never auto-advances, so the whole flow stays testable offline.
  const advances = report.engine !== "mock" && report.status === "SHORTLISTED";

  const assessed = await store.updateCandidate(candidateId, (current) => {
    if (current.status !== "screening") return;
    current.resumeScreening = report;
    if (!advances) {
      // Below the bar or borderline: the candidate waits for a person. Nothing is
      // auto-rejected, HR still sees the full breakdown either way.
      current.questions = [];
      current.status = "awaiting_screening";
      delete current.screeningError;
    }
  });
  if (!assessed || assessed.status !== "screening") return;

  if (!advances) {
    // Either borderline or below the floor. A person decides, so a person is told.
    await notifyAboutCandidate("awaiting_hr_review", candidateId);
    return;
  }

  try {
    await openInterviewOrWaitForDetails(candidateId);
  } catch (err) {
    await markScreeningFailed(candidateId, err);
    throw err;
  }

  // The interview is now live, so the link in the "interview ready" mail actually
  // works. Sending before this point would hand a candidate a dead URL.
  await notifyInterviewReady(candidateId);
}

/** Record a notification on the candidate, keeping the stored list bounded. */
async function persistNotification(candidateId: string, record: NotificationRecord): Promise<void> {
  await store.updateCandidate(candidateId, (current) => {
    const existing = current.notifications ?? [];
    // A pathological mail outage would otherwise grow this row without limit.
    current.notifications = [...existing, record].slice(-20);
  });
}

/**
 * Tell the candidate, or HR, what happened.
 *
 * Wrapped so a mail failure can never fail the screening that triggered it: the
 * attempt is still recorded, so HR can see it and retry.
 */
export async function notifyAboutCandidate(event: NotificationEvent, candidateId: string): Promise<void> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) return;
  try {
    await notify(event, candidate, (record) => persistNotification(candidateId, record));
  } catch (error) {
    console.warn(`[screening] ${event} notification for ${candidateId} did not complete:`, error);
  }
}

/**
 * Tell a candidate their interview is open.
 *
 * Called from both the automatic path and the admin route, because a person
 * advancing a candidate by hand opens the same interview the model would have.
 * No-ops unless an interview is genuinely open.
 */
export async function notifyInterviewReady(candidateId: string): Promise<void> {
  await notifyAboutCandidate("interview_ready", candidateId);
}

export async function markScreeningFailed(candidateId: string, error: unknown): Promise<void> {
  await store.updateCandidate(candidateId, (candidate) => {
    if (candidate.status !== "screening") return;
    candidate.status = "awaiting_screening";
    candidate.screeningError = error instanceof Error
      ? `Automated screening failed; HR review is required. ${error.message}`
      : "Automated screening failed; HR review is required.";
  });
  // A candidate who hit a screening error has no score and no verdict, so nothing
  // else in the system surfaces them. Tell HR, or they simply wait for a candidate
  // who will never move on their own.
  await notifyAboutCandidate("awaiting_hr_review", candidateId);
}
