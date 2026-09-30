export type StaffRole = "hr" | "manager" | "superadmin";

/** A dashboard account. Applicants don't have these; they get an interview login by email (CandidateAccess). */
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
  /** The Google Form applicants fill in for this job (created from the dashboard). */
  googleForm?: GoogleJobForm;
  /** Resume screening rules. Missing means the defaults (pass mark 60, no experience minimum). */
  screening?: JobScreening;
}

export interface JobScreening {
  /** Resumes the AI rates at or above this (0-100) are shortlisted. */
  passMark: number;
  /** Applicants with less total experience (years) are not selected, whatever the resume score. */
  minExperience: number | null;
}

/** The resume check that decides who is invited to interview. */
export interface Screening {
  /** 0-100 match between resume and job description; null when there was no readable resume. */
  score: number | null;
  /** selected: interview invite; rejected: rejection email; review: waiting for HR to decide. */
  decision: "selected" | "rejected" | "review";
  /** For HR only, never sent to the applicant. */
  summary: string;
  strengths: string[];
  gaps: string[];
  /** Rule-based reasons, e.g. below the experience minimum or pass mark. */
  reasons: string[];
  at: string;
  /** Set when HR changed the decision. */
  decidedBy?: string;
  /** When the "application received" email went out, or why it failed. */
  receivedEmailedAt?: string;
  receivedEmailError?: string;
  /** When the rejection email went out. */
  rejectionEmailedAt?: string;
}

/** Form fields the app reads from each response, keyed to the form's question ids. */
export type FormField =
  | "fullName"
  | "email"
  | "phone"
  | "totalExperience"
  | "currentLocation"
  | "linkedin"
  | "currentCTC"
  | "expectedCTC"
  | "joiningCategory"
  | "resumeUrl";

export interface GoogleJobForm {
  formId: string;
  /** The link applicants open. */
  responderUri: string;
  /** Google account that owns the form. */
  owner: string;
  createdAt: string;
  /** Question id for each field. Email may instead come from the form's own email collection. */
  questionIds: Partial<Record<FormField, string>>;
  emailFromSettings: boolean;
  /** The "File upload" resume question, added by hand in Google Forms; found automatically. */
  uploadQuestionId?: string;
  /** Responses submitted up to this time have been read (RFC 3339, from Google). */
  syncedUntil?: string;
  lastCheckedAt?: string;
  /** Last problem reading responses, shown to HR; cleared on the next successful check. */
  lastError?: string;
  /** Responses that couldn't become candidates (e.g. already applied, no valid email). */
  skipped?: { at: string; name: string; reason: string }[];
}

/** Candidate login for the interview: emailed after applying, valid for a limited time. */
export interface CandidateAccess {
  /** When the decision email (shortlisted with login, or rejection) is due: applied + DECISION_DELAY_MINUTES. */
  inviteAt: string;
  passwordHash?: string;
  /** Bumped when a new password is issued, signing out older sessions. */
  version: number;
  invitedAt?: string;
  /** The interview must be started before this. */
  expiresAt?: string;
  /** How the last login details went out: emailed, or shown to HR to pass on. */
  delivery?: "email" | "manual";
  /** Last email failure; the invite is retried at retryAt. */
  emailError?: string;
  retryAt?: string;
}

export type PublicJob = Pick<Job, "id" | "title" | "location" | "description">;

/** What the Jobs tab shows about the Google connection. */
export interface GoogleStatus {
  /** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. */
  configured: boolean;
  connection: { email: string; connectedAt: string; connectedBy: string; canSendMail: boolean; canReadDrive: boolean } | null;
  /** Managers and Super Admins may connect or disconnect. */
  canConnect: boolean;
  /** How emails go out now, or null when they can't. */
  emailRoute: "smtp" | "gmail" | null;
  /** Result of a connect attempt, shown once. */
  message: { tone: "info" | "error"; text: string } | null;
}

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
  transcriptSource?: "browser" | "whisper" | "gemini";
  /** The original browser transcript, kept when server speech-to-text replaced it. */
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

/** "rejected": not selected at resume screening (no interview). */
export type CandidateStatus = "ready" | "in_progress" | "evaluating" | "evaluation_failed" | "completed" | "rejected";

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
  /** Name under videos/<candidateId>/. Chunks are stored as `<file>.part<seq>` (see screenChunkName). */
  file: string;
  startedAt: string;
  chunks: number;
  bytes: number;
  /** Size of each chunk. Missing on recordings saved before cloud storage: those are one appended file. */
  chunkBytes?: number[];
}

/** Stored name of one screen-recording chunk. */
export const screenChunkName = (file: string, seq: number) => `${file}.part${seq}`;

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
  /** The stored resume file; null when the applicant's resume link couldn't be read. */
  resume: { fileName: string; storedAs: string } | null;
  /** Resume link from the Google Form. */
  resumeUrl?: string;
  /** Why the resume link couldn't be read (questions then come from the job description only). */
  resumeProblem?: string;
  source?: "website" | "google_form";
  /** Google Form response this candidate came from. */
  googleResponseId?: string;
  /** Email + password login for the interview. Missing on older candidates, who use the link alone. */
  access?: CandidateAccess;
  /** Resume screening; missing on candidates from before screening existed (all were invited). */
  screening?: Screening;
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
  /** When the videos, snapshots and screen recordings were deleted under MEDIA_RETENTION_DAYS. */
  mediaDeletedAt?: string;
  /** Sent to the dashboard only: when the media will be deleted automatically. */
  mediaDeletesOn?: string;
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
  /** For interviews not started yet: where the login invite stands. */
  invite: InviteState | null;
  screening: Pick<Screening, "score" | "decision"> | null;
}

export type InviteState = "review" | "scheduled" | "sent" | "email_failed" | "expired";

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
  /** Answers are transcribed on the server, so the browser's own speech recognition is optional. */
  serverTranscription: boolean;
  /** The interview must be started before this (ISO), or null when there's no deadline. */
  startBy: string | null;
}
