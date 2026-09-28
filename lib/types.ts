export interface Job {
  id: string;
  title: string;
  location: string;
  description: string;
  /** Internal salary budget in ₹ LPA. Never sent to applicants. */
  salaryMin: number | null;
  salaryMax: number | null;
  active: boolean;
  /**
   * ISO date (YYYY-MM-DD) the role was first published, which is what
   * schema.org/JobPosting.datePosted has to report. Optional because records
   * written before the careers page existed have no value; consumers fall back
   * to today. Editing a role must not change it, or the listing looks fresh to
   * aggregators on every tweak.
   */
  postedAt?: string;
}

export type PublicJob = Pick<Job, "id" | "title" | "location" | "description">;

export interface Question {
  question: string;
  focus: string;
  based_on: "job_description" | "resume";
  /** Grader-only rubric, never shown to the candidate. */
  expected_points: string[];
}

export interface ResumeScreening {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

/** The three outcomes a candidate can land in. Nothing is ever auto-rejected. */
export type ScreeningStatus = "SHORTLISTED" | "HR_REVIEW" | "NOT_SHORTLISTED";

/** Which scorer produced a result, so HR knows how much weight to give it. */
export type ScreeningEngine = "bridge" | "llm" | "mock";

/** The five weighted dimensions from the screening spec, plus the raw model signals. */
export interface ScreeningScores {
  requiredSkills: number;
  experience: number;
  education: number;
  projects: number;
  semantic: number;
  finalScore: number;
  /** The Python matcher's own 0.6*semantic + 0.4*coverage score, for comparison. */
  nativeScreeningScore: number | null;
  semanticSimilarity: number | null;
  skillCoveragePercent: number | null;
  threshold: number;
  reviewThreshold: number;
  marginToThreshold: number;
}

/** Fields the engine read out of the resume itself, rather than the registration form. */
export interface ScreeningCandidateProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  employers: string[];
  education: string[];
  certifications: string[];
  skills: string[];
}

/** What the job description asked for, in the form the dimensions were scored against. */
export interface ScreeningJobRequirements {
  minExperienceYears: number | null;
  degrees: string[];
}

export interface ResumeScreeningReport extends ResumeScreening {
  recommendation: "advance" | "hr_review";
  engine: ScreeningEngine;
  status: ScreeningStatus;
  scores: ScreeningScores;
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  bonusSkills: string[];
  recommendedNextStep: string;
  candidateProfile?: ScreeningCandidateProfile;
  jobRequirements?: ScreeningJobRequirements;
  extractionMethod?: string;
  engineNotes?: string[];
}

export interface Answer {
  /** Browser speech-to-text of the spoken answer. May contain recognition errors. */
  transcript: string;
  timeTakenSec: number;
  submittedAt: string;
  /** File names inside data/videos/<candidateId>/ */
  video: string | null;
  snapshots: string[];
}

export interface Evaluation {
  evaluations: { score: number; feedback: string }[];
  summary: string;
  strengths: string[];
  concerns: string[];
  /** Webcam-snapshot issues for HR to review (no face, second person, etc.). Not part of the score. */
  proctoringNotes: string[];
}

export interface Scores {
  interview: { points: number; max: number; averageOutOf10: number };
  joining: { points: number; label: string };
  salary: { points: number; notes: string[] };
  total: number;
  recommendation: string;
}

export type CandidateStatus =
  | "awaiting_screening"
  | "screening"
  | "profile_pending"
  | "ready"
  | "in_progress"
  | "evaluating"
  | "evaluation_failed"
  | "completed";

/**
 * HR's own hire decision, made by hand. Deliberately separate from the AI
 * recommendation: the model advises, a person decides, and the two can differ.
 */
export type HrDecision = "selected" | "rejected";

export interface HrDecisionRecord {
  outcome: HrDecision;
  /** When HR made the call, kept for the audit trail. */
  at: string;
}

export type ProctorEventType =
  | "face_missing"
  | "multiple_faces"
  | "looking_away"
  | "phone_detected"
  | "left_window"
  | "fullscreen_exit"
  | "typing"
  | "copy_attempt"
  | "second_screen"
  | "screen_share_stopped"
  | "proctoring_unavailable";

export interface ProctorEvent {
  type: ProctorEventType;
  at: string;
  /** Question on screen when it happened (null before the first question). */
  questionIndex: number | null;
  detail: string;
  /** Snapshot file in data/videos/<candidateId>/, if one was taken. */
  snapshot: string | null;
}

/** One continuous screen recording; a new segment starts each time the candidate re-shares. */
export interface ScreenSegment {
  /** File in data/videos/<candidateId>/ */
  file: string;
  startedAt: string;
  chunks: number;
  bytes: number;
  /** Per-part lengths when chunks are stored separately in object storage. */
  chunkSizes?: number[];
}

export interface IntegritySummary {
  level: "low" | "medium" | "high";
  points: number;
  counts: Partial<Record<ProctorEventType, number>>;
}

export interface PreviousAttempt {
  archivedAt: string;
  questions: Question[];
  answers: Answer[];
  proctoring: { events: ProctorEvent[] };
  screenRecording?: Candidate["screenRecording"];
  startedAt?: string;
  completedAt?: string;
  interruption?: Candidate["interruption"];
  evaluation?: Evaluation;
  scores?: Scores;
}

export interface CandidateProfile {
  fullName: string;
  email: string;
  phone: string;
  jobId: string;
  totalExperience: number;
  currentLocation: string;
  linkedin: string;
  currentCTC: number;
  expectedCTC: number;
  joiningCategory: string;
}

/**
 * What happened that might need telling someone about.
 *
 * Deliberately not modelled as a candidate status change: nothing is ever
 * rejected by notification, so a not-shortlisted applicant is not an event.
 */
export type NotificationEvent = "application_received" | "interview_ready" | "awaiting_hr_review";

export type NotificationChannel = "email";

export interface NotificationRecord {
  event: NotificationEvent;
  at: string;
  channel: NotificationChannel;
  ok: boolean;
  /** Present when the send failed or was skipped. */
  error?: string;
}

export interface Candidate extends CandidateProfile {
  id: string;
  createdAt: string;
  jobTitle: string;
  /** Snapshot so later JD/budget edits don't change how this candidate is graded. */
  jobSnapshot: Pick<Job, "title" | "description" | "salaryMin" | "salaryMax">;
  resume: { fileName: string; storedAs: string };
  resumeScreening?: ResumeScreeningReport;
  /**
   * Every notification attempt, successful or not, newest last.
   *
   * Kept on the record so HR can answer "was this candidate told?" without
   * digging through mail logs, and so a failed send is visible and retryable
   * rather than silently lost.
   */
  notifications?: NotificationRecord[];
  /**
   * False from the moment they apply until they submit the post-shortlist details
   * step, which asks for experience, location, LinkedIn, salary and joining.
   *
   * False is the normal state for a candidate still in screening, so anything
   * that reads a salary or a joining date has to check this first — /admin
   * renders "–" rather than "₹0 LPA" for a record that has not been asked yet.
   */
  profileComplete: boolean;
  status: CandidateStatus;
  screeningError?: string;
  /**
   * Set when the interview opened on job-description questions instead of model-written
   * ones, because the AI provider could not produce a valid set.
   *
   * These are real questions a real candidate answers, so this is a note for /admin,
   * not a warning to show them. The candidate simply gets their interview.
   */
  questionsFallback?: boolean;
  questions: Question[];
  answers: Answer[];
  proctoring: { events: ProctorEvent[] };
  /** Whole-interview screen recording, uploaded in chunks while the interview runs. */
  screenRecording?: { segments: ScreenSegment[] };
  /** Issued when the interview starts; only this browser session may submit answers. */
  sessionId?: string;
  /** Last heartbeat/answer/event from the active session. */
  lastSeenAt?: string;
  /** Set when the interview stopped midway and was auto-submitted. */
  interruption?: { at: string; reason: string; answeredCount: number };
  /** Earlier attempts, kept for audit when HR allows a re-interview. */
  attempts?: PreviousAttempt[];
  startedAt?: string;
  completedAt?: string;
  evaluatedAt?: string;
  evaluation?: Evaluation;
  scores?: Scores;
  evaluationError?: string;
  /** HR's manual hire decision. Absent until someone makes one. */
  decision?: HrDecisionRecord;
}

export interface CandidateSummary
  extends Pick<
    Candidate,
    | "id"
    | "createdAt"
    | "fullName"
    | "email"
    | "phone"
    | "jobId"
    | "jobTitle"
    | "totalExperience"
    | "currentCTC"
    | "expectedCTC"
    | "joiningCategory"
    | "status"
    | "profileComplete"
  > {
  answered: number;
  totalQuestions: number;
  scores: Scores | null;
  interrupted: boolean;
  integrity: IntegritySummary;
  /** HR's hire decision, or null while nobody has decided. Flattened for the table. */
  decision: HrDecision | null;
  /** When that decision was made, or null. */
  decidedAt: string | null;
}

export interface InterviewState {
  fullName: string;
  jobTitle: string;
  status: CandidateStatus;
  total: number;
  answered: number;
  minutesPerQuestion: number;
  prepSeconds: number;
  nextQuestion: { index: number; text: string } | null;
  /** True once the interview has been auto-submitted after stopping midway. */
  interrupted: boolean;
  interruptionReason: string | null;
  /**
   * Which way Round 1 screening went, so the waiting page can say something
   * accurate. The numeric score is deliberately not exposed here: the candidate
   * sees an outcome, not a grade, and HR keeps the breakdown.
   */
  screeningStatus: ScreeningStatus | null;
  hrContact: string;
  maxWarnings: number;
  awayGraceSeconds: number;
}
