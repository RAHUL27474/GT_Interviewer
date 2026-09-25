export type StaffRole = "hr" | "manager" | "superadmin";

/** A dashboard account. Applicants don't have accounts; they use their private interview link. */
export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  /** "scrypt:<salt>:<hash>" */
  passwordHash: string;
  active: boolean;
  /** When the account was deactivated; it is deleted automatically after ACCOUNT_DELETE_AFTER_DAYS. */
  deactivatedAt?: string;
  /** Bumped on password reset / deactivation to sign out existing sessions. */
  sessionVersion: number;
  createdAt: string;
  lastLoginAt?: string;
}

export type PublicStaffUser = Omit<StaffUser, "passwordHash" | "sessionVersion"> & {
  /** For deactivated accounts: when the automatic deletion will happen. */
  deletesAt?: string;
};

export interface Job {
  id: string;
  title: string;
  location: string;
  description: string;
  /** Internal salary budget in ₹ LPA. Never sent to applicants. */
  salaryMin: number | null;
  salaryMax: number | null;
  active: boolean;
  /** Staff email of whoever last created/edited this job. */
  updatedBy?: string;
}

export type PublicJob = Pick<Job, "id" | "title" | "location" | "description">;

export interface Question {
  question: string;
  focus: string;
  based_on: "job_description" | "resume";
  /** Grader-only rubric, never shown to the candidate. */
  expected_points: string[];
}

export interface Answer {
  /** Speech-to-text of the spoken answer. May contain recognition errors. */
  transcript: string;
  /** Where `transcript` came from; missing means the browser. */
  transcriptSource?: "browser" | "whisper";
  /** The original browser transcript, kept when Whisper replaced it. */
  browserTranscript?: string;
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

export type CandidateStatus = "ready" | "in_progress" | "evaluating" | "evaluation_failed" | "completed";

export type ProctorEventType =
  | "face_missing"
  | "multiple_faces"
  | "different_person"
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
}

export interface IntegritySummary {
  level: "low" | "medium" | "high";
  points: number;
  counts: Partial<Record<ProctorEventType, number>>;
}

export interface PreviousAttempt {
  archivedAt: string;
  /** Staff email of whoever allowed the re-interview. */
  archivedBy?: string;
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

export interface Candidate extends CandidateProfile {
  id: string;
  createdAt: string;
  jobTitle: string;
  /** Snapshot so later JD/budget edits don't change how this candidate is graded. */
  jobSnapshot: Pick<Job, "title" | "description" | "salaryMin" | "salaryMax">;
  resume: { fileName: string; storedAs: string };
  status: CandidateStatus;
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
  > {
  answered: number;
  totalQuestions: number;
  scores: Scores | null;
  interrupted: boolean;
  integrity: IntegritySummary;
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
  hrContact: string;
  maxWarnings: number;
  awayGraceSeconds: number;
  maxLookAwayWarnings: number;
  secondPersonGraceSeconds: number;
}
