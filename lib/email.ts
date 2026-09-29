// Outgoing email: through SMTP when SMTP_HOST is set (any provider), otherwise through Gmail on the connected
// Google account (lib/google.ts). With neither, nothing is sent and HR passes login details on by hand.
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config";
import { googleApi, googleConnection } from "./google";
import { logger, who } from "./log";
import type { Candidate } from "./types";

const log = logger("email");

const smtpEnabled = Boolean(config.smtp.host && config.smtp.from);
export const emailLabel = smtpEnabled ? `SMTP ${config.smtp.host}` : "Gmail of the connected Google account, if any";

export type EmailRoute = "smtp" | "gmail";

/** How email would go out right now, or null if it can't. */
export async function emailRoute(): Promise<EmailRoute | null> {
  if (smtpEnabled) return "smtp";
  const google = await googleConnection().catch(() => null);
  return google?.canSendMail ? "gmail" : null;
}

export interface Mail {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
}

let smtp: Transporter | null = null;

/** Sends one email. Throws if it can't be sent (or no email route is set up). */
export async function send(mail: Mail) {
  const route = await emailRoute();
  if (route === "smtp") {
    smtp ??= nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    await smtp.sendMail({ from: config.smtp.from, ...mail });
    return;
  }
  if (route === "gmail") {
    const account = (await googleConnection())!.email;
    // nodemailer only builds the message here; Gmail sends it.
    const built = await nodemailer
      .createTransport({ streamTransport: true, buffer: true, newline: "windows" })
      .sendMail({ from: config.smtp.from || { name: config.companyName, address: account }, ...mail });
    await googleApi("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: (built.message as Buffer).toString("base64url") }),
    });
    return;
  }
  throw new Error("Email isn't set up: connect Google (Jobs tab) or set SMTP_HOST.");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
/** Names come from the public form; keep them to one line in subjects. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Absolute link to a page, or null when neither APP_URL nor a request origin is known. */
export function appLink(path: string, origin?: string) {
  const base = config.appUrl || origin?.replace(/\/+$/, "");
  return base ? `${base}${path}` : null;
}

/** "29 Sept 2026, 4:30 pm IST" in the configured time zone. */
export function formatDeadline(iso: string, timeZone = config.timeZone) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function loginDetailsMail(
  c: Pick<Candidate, "fullName" | "email" | "jobTitle">,
  opts: {
    loginUrl: string;
    password: string;
    expiresAt: string;
    reinterview: boolean;
    company: string;
    minutes: number;
    hrContact: string;
    timeZone?: string;
  },
): Mail {
  const deadline = formatDeadline(opts.expiresAt, opts.timeZone);
  const intro = opts.reinterview
    ? `HR has approved a new attempt at your video interview for ${c.jobTitle}. You'll get new questions, and your old password no longer works.`
    : `Thank you for applying for ${c.jobTitle}. Your AI video interview is ready.`;
  const needs =
    "Use a laptop or desktop with a webcam and microphone (Google Chrome or Microsoft Edge), in a quiet place. " +
    "You'll be asked to share your entire screen and stay in fullscreen. Once started, the interview can't be paused or restarted.";
  const text = [
    `Hi ${oneLine(c.fullName)},`,
    "",
    intro,
    "",
    `Log in here: ${opts.loginUrl}`,
    `Email: ${c.email}`,
    `Password: ${opts.password}`,
    "",
    `Please start the interview before ${deadline}. After that, these login details stop working.`,
    `It takes about ${opts.minutes} minutes. ${needs}`,
    "",
    `Questions? Contact ${opts.hrContact}.`,
    "",
    opts.company,
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(c.fullName)},</p>
<p>${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;margin:12px 0;font-size:15px">
<tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td style="padding:4px 0"><strong>${escapeHtml(c.email)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Password</td><td style="padding:4px 0"><strong style="font-family:monospace;font-size:17px;letter-spacing:1px">${escapeHtml(opts.password)}</strong></td></tr>
</table>
<p><a href="${escapeHtml(opts.loginUrl)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Log in to the interview</a></p>
<p><strong>Please start before ${escapeHtml(deadline)}.</strong> After that, these login details stop working.</p>
<p>It takes about ${opts.minutes} minutes. ${escapeHtml(needs)}</p>
<p style="color:#555">If the button doesn't work, open ${escapeHtml(opts.loginUrl)}<br>Questions? Contact ${escapeHtml(opts.hrContact)}.</p>
<p>${escapeHtml(opts.company)}</p>`;
  return {
    to: c.email,
    subject: `${opts.reinterview ? "New attempt: " : ""}Your video interview for ${oneLine(c.jobTitle)} - ${oneLine(opts.company)}`,
    text,
    html,
  };
}

export function gradedMail(c: Candidate, to: string[], dashboard: string | null): Mail {
  const result = c.scores
    ? `${c.scores.recommendation}, total ${c.scores.total}`
    : `grading failed${c.evaluationError ? ` (${c.evaluationError})` : ""}; re-run it from the dashboard`;
  const flags = c.interruption ? ` The interview was interrupted: ${c.interruption.reason}.` : "";
  const line = `${oneLine(c.fullName)} (${oneLine(c.jobTitle)}): ${result}.${flags}`;
  return {
    to,
    subject: `Interview graded: ${oneLine(c.fullName)} - ${c.scores?.recommendation ?? "needs attention"}`,
    text: `${line}\n\n${dashboard ? `Review it: ${dashboard}` : "Review it in the staff dashboard."}`,
    html: `<p>${escapeHtml(line)}</p><p>${
      dashboard ? `<a href="${escapeHtml(dashboard)}">Open the staff dashboard</a>` : "Review it in the staff dashboard."
    }</p>`,
  };
}

/** Tells HR_NOTIFY_EMAILS that an interview has been graded (or that grading failed). Never throws. */
export async function notifyGraded(c: Candidate) {
  if (!config.hrNotifyEmails.length) return;
  try {
    await send(gradedMail(c, config.hrNotifyEmails, appLink("/admin")));
    log.info(`${who(c)}: HR notified`);
  } catch (err) {
    log.error(`${who(c)}: HR notification not sent`, err);
  }
}
