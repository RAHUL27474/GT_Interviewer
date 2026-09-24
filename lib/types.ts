export interface Job {
  id: string;
  title: string;
  location: string;
  description: string;
  /** Internal salary budget in ₹ LPA. Never sent to applicants. */
  salaryMin: number | null;
  salaryMax: number | null;
  active: boolean;
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

export type CandidateStatus = "ready" | "in_progress" | "evaluating" | "evaluation_failed" | "completed";

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
  integrity: { tabSwitches: number };
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
}
