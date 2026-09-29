// Candidate login for the interview. INVITE_DELAY_MINUTES after applying, the candidate is emailed a random password;
// they then have INTERVIEW_ACCESS_HOURS to log in and start. Once started, the interview runs to the end as usual.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { hashPassword, loginLimiter, readSignedToken, signedToken, verifyPassword } from "./auth";
import { config } from "./config";
import { appLink, formatDeadline, loginDetailsMail, send } from "./email";
import { HttpError } from "./http";
import { accessExpired, inviteState, startDeadline } from "./invite-state";
import { logger, who } from "./log";
import { store } from "./store";
import type { Candidate, CandidateAccess } from "./types";

const log = logger("invite");

export const CANDIDATE_COOKIE = "candidate_session";
const SESSION_SECONDS = 6 * 60 * 60;
/** How long before a failed invite email is tried again (and how long a sending server holds its claim). */
const RETRY_MS = 10 * 60 * 1000;

// No look-alike characters (0/O, 1/l/I), so it can be typed from the email without mistakes.
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(length = 10) {
  return Array.from({ length }, () => PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)]).join("");
}

/** Access for a new applicant: login details are due INVITE_DELAY_MINUTES after `appliedAt`. */
export function newAccess(appliedAt: Date): CandidateAccess {
  return { inviteAt: new Date(appliedAt.getTime() + config.inviteDelayMinutes * 60_000).toISOString(), version: 0 };
}

export { accessExpired, inviteState, startDeadline };


export interface IssueResult {
  emailed: boolean;
  /** Only when the email couldn't be sent and HR asked for the details, so they can pass them on. */
  password?: string;
  error?: string;
}

/**
 * Gives the candidate a fresh password and a new INTERVIEW_ACCESS_HOURS window, and emails it.
 * `showOnFailure` (HR clicked the button): if the email fails, the password is still saved and returned.
 * Otherwise (the scheduled send) a failure is recorded and retried later.
 */
export async function issueLoginDetails(
  id: string,
  opts: { reinterview?: boolean; origin?: string; showOnFailure?: boolean } = {},
): Promise<IssueResult> {
  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  const password = generatePassword();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.interviewAccessHours * 3_600_000).toISOString();

  let error: string | undefined;
  const loginUrl = appLink("/", opts.origin);
  if (!loginUrl) {
    error = "APP_URL is not set, so the email can't include a login link.";
  } else {
    try {
      await send(
        loginDetailsMail(c, {
          loginUrl,
          password,
          expiresAt,
          reinterview: Boolean(opts.reinterview),
          company: config.companyName,
          minutes: config.questionCount * (config.minutesPerQuestion + 1),
          hrContact: config.hrContact,
        }),
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  if (error && !opts.showOnFailure) {
    await store.updateCandidate(id, (cand) => {
      cand.access ??= newAccess(now);
      cand.access.emailError = error;
      cand.access.retryAt = new Date(Date.now() + RETRY_MS).toISOString();
    });
    log.error(`${who(c)}: login email failed, will retry: ${error}`);
    return { emailed: false, error };
  }

  await store.updateCandidate(id, (cand) => {
    const access = (cand.access ??= newAccess(now));
    access.passwordHash = hashPassword(password);
    access.version += 1;
    access.invitedAt = now.toISOString();
    access.expiresAt = expiresAt;
    access.delivery = error ? "manual" : "email";
    delete access.emailError;
    delete access.retryAt;
  });
  if (error) {
    log.warn(`${who(c)}: new login details for HR to pass on (email failed: ${error})`);
    return { emailed: false, password, error };
  }
  log.info(`${who(c)}: login details emailed, valid until ${formatDeadline(expiresAt)}`);
  return { emailed: true };
}

let sweeping = false;

/** Emails login details that have come due (INVITE_DELAY_MINUTES after applying). Runs every few seconds. */
export async function sendDueInvites() {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    const due = (await store.listCandidatesByStatus("ready")).filter(
      (c) =>
        c.access &&
        !c.access.invitedAt &&
        Date.parse(c.access.inviteAt) <= now &&
        (!c.access.retryAt || Date.parse(c.access.retryAt) <= now),
    );
    for (const c of due) {
      // Claim it first, so a second app server doesn't send the same email.
      let claimed = false;
      await store.updateCandidate(c.id, (cand) => {
        const a = cand.access;
        if (!a || a.invitedAt || (a.retryAt && Date.parse(a.retryAt) > Date.now())) return;
        a.retryAt = new Date(Date.now() + RETRY_MS).toISOString();
        claimed = true;
      });
      if (claimed) await issueLoginDetails(c.id);
    }
  } finally {
    sweeping = false;
  }
}

// ---------- Candidate sessions ----------

const limiter = loginLimiter();

/** Checks an email + password against every application with that email. Returns the matching one. */
export async function candidateLogin(emailInput: unknown, passwordInput: unknown): Promise<Candidate> {
  const email = String(emailInput ?? "").trim().toLowerCase();
  const password = String(passwordInput ?? "").trim();
  if (!email || !password) throw new HttpError(400, "Enter the email and password from your interview email.");
  limiter.check(email);
  const matches = (await store.listCandidatesByEmail(email))
    .filter((c) => c.access?.passwordHash && verifyPassword(password, c.access.passwordHash))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const c = matches[0];
  if (!c) {
    limiter.fail(email);
    throw new HttpError(401, "Wrong email or password. Use the password from your most recent interview email.");
  }
  limiter.succeed(email);
  if (accessExpired(c)) {
    throw new HttpError(
      403,
      `The time to start this interview ended on ${formatDeadline(c.access!.expiresAt!)}. Please contact ${config.hrContact}.`,
    );
  }
  return c;
}

export async function setCandidateCookie(c: Candidate) {
  (await cookies()).set(CANDIDATE_COOKIE, signedToken({ cid: c.id, v: c.access?.version ?? 0 }, SESSION_SECONDS), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearCandidateCookie() {
  (await cookies()).delete(CANDIDATE_COOKIE);
}

/** Whether this browser is logged in as `c` (older candidates without a login use their link alone). */
export async function isCandidateSession(c: Candidate) {
  if (!c.access) return true;
  const token = (await cookies()).get(CANDIDATE_COOKIE)?.value;
  const data = token ? readSignedToken<{ cid: string; v: number }>(token) : null;
  return Boolean(data && data.cid === c.id && c.access.passwordHash && data.v === c.access.version);
}

/** Throws 401 unless this browser is logged in as `c`, and 403 if their time to start has run out. */
export async function requireCandidate(c: Candidate) {
  if (!(await isCandidateSession(c))) throw new HttpError(401, "Please log in again with the details from your interview email.");
  if (accessExpired(c)) throw new HttpError(403, `The time to start this interview has ended. Please contact ${config.hrContact}.`);
}
