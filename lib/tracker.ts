// What an applicant sees on their tracking page. Shared by the server and the page (no Node imports).
// Only what they've already been told by email is shown: the decision appears once its email has gone out, and
// scores, AI ratings and HR notes are never shown.
import { accessExpired } from "./invite-state";
import type { Candidate } from "./types";

export type StepState = "done" | "current" | "upcoming" | "failed";

export interface TrackerStep {
  title: string;
  state: StepState;
  at?: string;
  detail?: string;
}

export interface TrackerView {
  ref: string;
  jobTitle: string;
  fullName: string;
  appliedAt: string;
  /** One-line summary at the top. */
  headline: string;
  tone: "neutral" | "good" | "bad";
  steps: TrackerStep[];
  /** Shown while the interview is open. */
  interview?: { startBy: string | null; started: boolean };
}

type TrackedCandidate = Pick<
  Candidate,
  | "applicationRef"
  | "jobTitle"
  | "fullName"
  | "createdAt"
  | "status"
  | "access"
  | "screening"
  | "startedAt"
  | "completedAt"
  | "interruption"
>;

export function trackerView(c: TrackedCandidate, now = Date.now()): TrackerView {
  const invited = Boolean(c.access?.invitedAt);
  const rejectedTold = c.status === "rejected" && Boolean(c.screening?.rejectionEmailedAt);
  const interviewing = c.status === "in_progress";
  const finished = c.status === "evaluating" || c.status === "completed" || c.status === "evaluation_failed";
  const expired = accessExpired(c, now);
  // Applications from before screening existed went straight to interview.
  const shortlisted = invited || interviewing || finished || (!c.screening && c.status !== "rejected");

  const steps: TrackerStep[] = [
    { title: "Application received", state: "done", at: c.createdAt, detail: "We've got your details and resume." },
  ];

  if (rejectedTold) {
    steps.push(
      { title: "Resume review", state: "done" },
      {
        title: "Not selected this time",
        state: "failed",
        at: c.screening?.rejectionEmailedAt,
        detail: "Thank you for applying. We won't be taking this application forward, but we'll keep your details on file.",
      },
    );
    return {
      ...base(c),
      headline: "Your application wasn't selected this time",
      tone: "bad",
      steps,
    };
  }

  if (!shortlisted) {
    steps.push(
      {
        title: "Resume review",
        state: "current",
        detail: "Our team is reviewing your application. You'll hear from us by email shortly.",
      },
      { title: "Shortlisting", state: "upcoming" },
      { title: "AI video interview", state: "upcoming" },
      { title: "Hiring team review", state: "upcoming" },
    );
    return { ...base(c), headline: "Your application is being reviewed", tone: "neutral", steps };
  }

  steps.push({ title: "Resume review", state: "done" }, { title: "Shortlisted", state: "done", at: c.access?.invitedAt });

  if (finished) {
    steps.push(
      {
        title: "AI video interview",
        state: "done",
        at: c.completedAt,
        detail: c.interruption ? "Your interview ended early and was submitted as it was." : "Your interview has been submitted.",
      },
      {
        title: "Hiring team review",
        state: "current",
        detail: "The hiring team is reviewing your interview and will contact you about next steps.",
      },
    );
    return { ...base(c), headline: "Your interview is with the hiring team", tone: "good", steps };
  }

  if (expired) {
    steps.push(
      { title: "AI video interview", state: "failed", detail: "The time to start the interview has ended. Please contact HR if you'd still like to take it." },
      { title: "Hiring team review", state: "upcoming" },
    );
    return { ...base(c), headline: "Your interview window has ended", tone: "bad", steps };
  }

  steps.push(
    {
      title: "AI video interview",
      state: "current",
      detail: interviewing
        ? "Your interview is in progress."
        : "Check your email for your login details, then start the interview before the deadline.",
    },
    { title: "Hiring team review", state: "upcoming" },
  );
  return {
    ...base(c),
    headline: interviewing ? "Your interview is in progress" : "You're shortlisted for the AI video interview",
    tone: "good",
    steps,
    interview: { startBy: interviewing ? null : (c.access?.expiresAt ?? null), started: interviewing },
  };
}

function base(c: TrackedCandidate) {
  return { ref: c.applicationRef ?? "", jobTitle: c.jobTitle, fullName: c.fullName, appliedAt: c.createdAt };
}
