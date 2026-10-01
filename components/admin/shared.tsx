import { INTEGRITY_LABEL } from "@/lib/proctoring";
import type { CandidateStatus, IntegritySummary, InviteState } from "@/lib/types";
import { cn, Pill, type Tone } from "../ui";

export const STATUS: Record<CandidateStatus, { label: string; tone: Tone }> = {
  ready: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "warn" },
  evaluating: { label: "Evaluating…", tone: "neutral" },
  evaluation_failed: { label: "Eval failed", tone: "bad" },
  completed: { label: "Completed", tone: "good" },
  rejected: { label: "Not selected", tone: "bad" },
};

/** For interviews not started yet: where the login email stands (replaces "Not started"). */
export const INVITE: Record<InviteState, { label: string; tone: Tone }> = {
  screening: { label: "Screening…", tone: "neutral" },
  review: { label: "Needs review", tone: "warn" },
  scheduled: { label: "Shortlisted, email scheduled", tone: "neutral" },
  sent: { label: "Invited", tone: "neutral" },
  email_failed: { label: "Email failed", tone: "bad" },
  expired: { label: "Expired", tone: "bad" },
};

/** Status pill text and colour, with the invite state for interviews not started yet. */
export const statusBadge = (c: { status: CandidateStatus; invite?: InviteState | null }) =>
  c.invite ? INVITE[c.invite] : STATUS[c.status];

const REC_TONE: Record<string, Tone> = { "Strong Hire": "good", Hire: "good", Maybe: "warn", Reject: "bad" };

export function RecommendationPill({ label }: { label: string }) {
  return <Pill tone={REC_TONE[label] ?? "neutral"}>{label}</Pill>;
}

const INTEGRITY_TONE: Record<IntegritySummary["level"], Tone> = { low: "good", medium: "warn", high: "bad" };

export function IntegrityPill({ level }: { level: IntegritySummary["level"] }) {
  return <Pill tone={INTEGRITY_TONE[level]}>{INTEGRITY_LABEL[level]}</Pill>;
}

/** Number with a sign and green/red colour: +15, −5, 0. */
export function Signed({ value }: { value: number }) {
  return (
    <span className={cn("font-semibold tabular-nums", value > 0 && "text-ok-fg", value < 0 && "text-danger-fg")}>
      {value > 0 ? "+" : ""}
      {value}
    </span>
  );
}
