// Proctoring event definitions and the integrity rating. Shared by browser and server (no Node imports).
import type { IntegritySummary, ProctorEvent, ProctorEventType } from "./types";

export const PROCTOR_EVENTS: Record<ProctorEventType, { label: string; weight: number; warning: string }> = {
  face_missing: { label: "Face not visible", weight: 2, warning: "We can't see your face. Please stay in front of the camera." },
  multiple_faces: { label: "More than one person", weight: 3, warning: "Another person is visible. The interview must be taken alone." },
  looking_away: { label: "Looking away", weight: 1, warning: "Please look at the screen while answering." },
  phone_detected: { label: "Phone in view", weight: 3, warning: "A phone is visible. Please put it away." },
  left_window: { label: "Left the interview window", weight: 2, warning: "You left the interview window. This has been recorded." },
  fullscreen_exit: { label: "Exited fullscreen", weight: 1, warning: "Please return to fullscreen." },
  typing: { label: "Typing during answer", weight: 2, warning: "Typing was detected. Please answer by speaking." },
  copy_attempt: { label: "Copy attempt", weight: 1, warning: "Copying is not allowed." },
  second_screen: { label: "Second monitor connected", weight: 3, warning: "A second monitor was detected." },
  screen_share_stopped: { label: "Stopped screen sharing", weight: 3, warning: "Screen sharing stopped. Please share your entire screen again." },
  proctoring_unavailable: { label: "Camera checks unavailable", weight: 0, warning: "" },
};

export const PROCTOR_EVENT_TYPES = Object.keys(PROCTOR_EVENTS) as ProctorEventType[];

/** Weighted sum of events: low < 4 <= medium < 10 <= high. */
export function computeIntegrity(events: ProctorEvent[]): IntegritySummary {
  const counts: IntegritySummary["counts"] = {};
  let points = 0;
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    points += PROCTOR_EVENTS[e.type]?.weight ?? 0;
  }
  const level = points >= 10 ? "high" : points >= 4 ? "medium" : "low";
  return { level, points, counts };
}

export const INTEGRITY_LABEL: Record<IntegritySummary["level"], string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};
