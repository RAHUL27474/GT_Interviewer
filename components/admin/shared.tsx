import type { CandidateStatus } from "@/lib/types";
import { cn, Pill, type Tone } from "../ui";

export const STATUS: Record<CandidateStatus, { label: string; tone: Tone }> = {
  ready: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "warn" },
  evaluating: { label: "Evaluating…", tone: "neutral" },
  evaluation_failed: { label: "Eval failed", tone: "bad" },
  completed: { label: "Completed", tone: "good" },
};

const REC_TONE: Record<string, Tone> = { "Strong Hire": "good", Hire: "good", Maybe: "warn", Reject: "bad" };

export function RecommendationPill({ label }: { label: string }) {
  return <Pill tone={REC_TONE[label] ?? "neutral"}>{label}</Pill>;
}

/** Number with a sign and green/red colour: +15, −5, 0. */
export function Signed({ value }: { value: number }) {
  return (
    <span className={cn("font-semibold tabular-nums", value > 0 && "text-emerald-600", value < 0 && "text-red-600")}>
      {value > 0 ? "+" : ""}
      {value}
    </span>
  );
}
