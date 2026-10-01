// Where a candidate's interview login stands. Shared by the server and the dashboard (no Node imports).
import type { Candidate, InviteState } from "./types";

type Pick_ = Pick<Candidate, "status" | "access"> & Partial<Pick<Candidate, "screening">>;

/** The candidate still has to start, and their time to do so has run out. */
export function accessExpired(c: Pick_, now = Date.now()) {
  return c.status === "ready" && Boolean(c.access?.expiresAt) && Date.parse(c.access!.expiresAt!) <= now;
}

/** Where the login invite stands, for interviews not started yet (null otherwise, or for older candidates). */
export function inviteState(c: Pick_, now = Date.now()): InviteState | null {
  if (c.status !== "ready" || !c.access) return null;
  if (!c.access.invitedAt && c.screening?.decision === "pending") return "screening";
  if (!c.access.invitedAt && c.screening?.decision === "review") return "review";
  if (!c.access.invitedAt) return c.access.emailError ? "email_failed" : "scheduled";
  return accessExpired(c, now) ? "expired" : "sent";
}

/** Deadline to start, shown to the candidate. */
export const startDeadline = (c: Pick_) => (c.status === "ready" ? (c.access?.expiresAt ?? null) : null);
