// Candidate login for the interview. DECISION_DELAY_MINUTES after applying, shortlisted candidates are emailed a random password;
// they then have INTERVIEW_ACCESS_HOURS to log in and start. Once started, the interview runs to the end as usual.
import crypto from "node:crypto";
import path from "node:path";
import { cookies } from "next/headers";
import { generateQuestions, resumeToPart } from "./ai";
import { hashPassword, loginLimiter, readSignedToken, signedToken, verifyPassword } from "./auth";
import { config } from "./config";
import { appLink, applicationReceivedMail, formatDeadline, loginDetailsMail, rejectionMail, send } from "./email";
import { files, resumeKey } from "./files";
import { HttpError } from "./http";
import { accessExpired, inviteState, startDeadline } from "./invite-state";
import { logger, who } from "./log";
import { store } from "./store";
import type { Candidate, CandidateAccess, Screening } from "./types";

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

/** Access for a new applicant: the decision email is due DECISION_DELAY_MINUTES after `appliedAt`. */
export function newAccess(appliedAt: Date): CandidateAccess {
  return { inviteAt: new Date(appliedAt.getTime() + config.decisionDelayMinutes * 60_000).toISOString(), version: 0 };
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

/** The "we've received your application" email, sent straight after the application is read. Never throws. */
export async function sendApplicationReceived(c: Candidate) {
  let error: string | undefined;
  try {
    await send(
      applicationReceivedMail(c, {
        company: config.companyName,
        decisionHours: Math.round((config.decisionDelayMinutes / 60) * 10) / 10,
      }),
    );
    log.info(`${who(c)}: application-received email sent`);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    log.error(`${who(c)}: application-received email failed: ${error}`);
  }
  await store.updateCandidate(c.id, (cand) => {
    if (!cand.screening) return;
    if (error) cand.screening.receivedEmailError = error;
    else {
      cand.screening.receivedEmailedAt = new Date().toISOString();
      delete cand.screening.receivedEmailError;
    }
  });
}

/** Sends the "not taken forward" email. On failure it's recorded and retried later. Returns whether it was sent. */
export async function sendRejection(id: string): Promise<boolean> {
  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  try {
    await send(rejectionMail(c, { company: config.companyName }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await store.updateCandidate(id, (cand) => {
      cand.access ??= newAccess(new Date());
      cand.access.emailError = error;
      cand.access.retryAt = new Date(Date.now() + RETRY_MS).toISOString();
    });
    log.error(`${who(c)}: rejection email failed, will retry: ${error}`);
    return false;
  }
  await store.updateCandidate(id, (cand) => {
    if (cand.screening) cand.screening.rejectionEmailedAt = new Date().toISOString();
    if (cand.access) {
      delete cand.access.emailError;
      delete cand.access.retryAt;
    }
  });
  log.info(`${who(c)}: rejection email sent`);
  return true;
}

/** Whether a decision email for `c` has come due and isn't already sent, being sent, or waiting for a retry. */
function decisionDue(c: Candidate, now: number) {
  const a = c.access;
  if (!a || Date.parse(a.inviteAt) > now || (a.retryAt && Date.parse(a.retryAt) > now)) return false;
  if (c.status === "rejected") return Boolean(c.screening && !c.screening.rejectionEmailedAt);
  // Candidates waiting for HR's review get nothing until HR decides.
  return c.status === "ready" && !a.invitedAt && c.screening?.decision !== "review";
}

let sweeping = false;

/**
 * Sends the decision emails that have come due (DECISION_DELAY_MINUTES after applying): login details to the
 * shortlisted, the rejection email to the rest. Runs every 30 seconds.
 */
export async function sendDueInvites() {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    const due = (await store.listCandidatesByStatus("ready", "rejected")).filter((c) => decisionDue(c, now));
    for (const c of due) {
      // Claim it first, so a second app server doesn't send the same email.
      let claimed = false;
      await store.updateCandidate(c.id, (cand) => {
        if (!decisionDue(cand, Date.now())) return;
        cand.access!.retryAt = new Date(Date.now() + RETRY_MS).toISOString();
        claimed = true;
      });
      if (!claimed) continue;
      if (c.status === "rejected") await sendRejection(c.id);
      else await issueLoginDetails(c.id);
    }
  } finally {
    sweeping = false;
  }
}

/**
 * HR overrides the screening: "selected" writes the interview questions if needed and emails the login now;
 * "rejected" emails the rejection now (unless already sent).
 */
export async function decideByHr(
  id: string,
  decision: "selected" | "rejected",
  by: string,
  origin?: string,
): Promise<IssueResult & { rejectionSent?: boolean }> {
  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  if (c.status !== "ready" && c.status !== "rejected") {
    throw new HttpError(409, "This candidate has already started or finished the interview.");
  }

  if (decision === "rejected") {
    await store.updateCandidate(id, (cand) => {
      cand.status = "rejected";
      cand.screening = { ...(cand.screening ?? emptyScreening()), decision: "rejected", decidedBy: by };
      cand.screening.reasons = [...cand.screening.reasons, `Rejected by ${by}.`];
      // A login already sent stops working.
      if (cand.access) {
        cand.access.version += 1;
        delete cand.access.passwordHash;
      }
    });
    log.info(`${who(c)}: rejected by ${by}`);
    const sent = c.screening?.rejectionEmailedAt ? true : await sendRejection(id);
    return { emailed: sent, rejectionSent: sent };
  }

  // Shortlisted by HR: rejected or unreadable-resume applicants have no questions yet.
  let questions = c.questions;
  if (!questions.length) {
    const resumePart = c.resume
      ? await resumeToPart(await files.get(resumeKey(c.resume.storedAs)), path.extname(c.resume.storedAs))
      : null;
    try {
      questions = await generateQuestions({ job: c.jobSnapshot, candidate: c, resumePart });
    } catch (err) {
      log.error(`${who(c)}: couldn't write questions:`, err);
      throw new HttpError(502, "The AI couldn't write interview questions right now. Please try again in a few minutes.");
    }
  }
  await store.updateCandidate(id, (cand) => {
    cand.status = "ready";
    cand.questions = questions;
    cand.screening = { ...(cand.screening ?? emptyScreening()), decision: "selected", decidedBy: by };
    cand.screening.reasons = [...cand.screening.reasons, `Shortlisted by ${by}.`];
  });
  log.info(`${who(c)}: shortlisted by ${by}`);
  return issueLoginDetails(id, { origin, showOnFailure: true });
}

function emptyScreening(): Screening {
  return { score: null, decision: "review", summary: "", strengths: [], gaps: [], reasons: [], at: new Date().toISOString() };
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
