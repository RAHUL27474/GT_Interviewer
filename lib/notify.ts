// Candidate and HR notifications, delivered over an HTTP email API.
//
// Two providers are supported because both are a single JSON POST and neither
// needs a dependency: Resend and SendGrid. Which one you use is a config
// choice, not a code change.
//
// Three rules shape this module:
//
// 1. Notification never blocks hiring. A failed send is recorded on the
//    candidate and logged; it never throws into screening or registration.
//    A candidate who cannot be emailed is still in the system for the interview.
// 2. Nothing is ever auto-rejected by message. The screening spec is explicit
//    that HR sees every candidate, so a not-shortlisted applicant receives no
//    rejection mail - only the acknowledgement they were promised.
// 3. No score ever leaves the building. Candidates are told what happened, not
//    what they scored, for the same reason the waiting page hides the number.
import { config } from "./config";
import type { Candidate, CandidateStatus, NotificationChannel, NotificationEvent, NotificationRecord } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

/** Escape text for HTML. Candidate-supplied names flow straight into these bodies. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

function layout(heading: string, paragraphs: string[]): string {
  return [
    "<div style=\"font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6\">",
    `<h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 14px">${p}</p>`),
    "</div>",
  ].join("");
}

function interviewUrl(candidate: Candidate): string {
  return `${config.appUrl}/interview/${encodeURIComponent(candidate.id)}`;
}

function contactLine(): string {
  return `If you need anything, reply to this email or contact ${escapeHtml(config.hrContact)}.`;
}

interface Message {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Build the message for one event. Pure, so it can be inspected in a test. */
export function buildMessage(event: NotificationEvent, candidate: Candidate): Message | null {
  const name = escapeHtml(candidate.fullName || "there");
  const job = escapeHtml(candidate.jobTitle);
  const contact = contactLine();

  switch (event) {
    case "application_received":
      return {
        to: candidate.email,
        subject: `We received your application for ${candidate.jobTitle}`,
        html: layout(`Thanks for applying, ${name}`, [
          `We have your application and resume for <strong>${job}</strong>.`,
          "Our team reviews every application by hand. You do not need to do anything else right now.",
          `If your resume is shortlisted, this is the same page you will use to start your short video interview: <a href="${interviewUrl(candidate)}">${escapeHtml(interviewUrl(candidate))}</a>`,
          contact,
        ]),
        text: [
          `Thanks for applying, ${candidate.fullName || "there"}.`,
          `We have your application and resume for ${candidate.jobTitle}.`,
          "Our team reviews every application by hand. You do not need to do anything else right now.",
          `If your resume is shortlisted, you can start your video interview here: ${interviewUrl(candidate)}`,
          contact,
        ].join("\n\n"),
      };

    case "interview_ready":
      // Guard rather than trust the caller. A candidate with no interview yet
      // would receive a link to a page that only says "under review", which reads
      // as a broken promise. A re-screening or re-interview path added later
      // would hit this, so the check lives in the template.
      if (!hasOpenInterview(candidate)) return null;
      return {
        to: candidate.email,
        subject: `Your interview is ready - ${candidate.jobTitle}`,
        html: layout(`${name}, you are through to the interview`, [
          `Your resume for <strong>${job}</strong> has been shortlisted.`,
          `Start your short video interview here: <a href="${interviewUrl(candidate)}">${escapeHtml(interviewUrl(candidate))}</a>`,
          "It takes about ten minutes. Find a quiet place, check your camera and microphone, and go when you are ready. The link works on a phone too.",
          contact,
        ]),
        text: [
          `${candidate.fullName || "there"}, you are through to the interview.`,
          `Your resume for ${candidate.jobTitle} has been shortlisted.`,
          `Start your short video interview here: ${interviewUrl(candidate)}`,
          "It takes about ten minutes. Find a quiet place, check your camera and microphone, and go when you are ready. The link works on a phone too.",
          contact,
        ].join("\n\n"),
      };

    case "awaiting_hr_review": {
      // Only a held candidate needs a decision. Alerting HR about someone who has
      // already been advanced is noise that trains people to ignore these.
      if (candidate.resumeScreening?.status === "SHORTLISTED") return null;
      const score = candidate.resumeScreening?.scores.finalScore;
      const where = score === undefined ? "" : ` It scored ${score}/100 and needs a decision.`;
      return {
        to: config.notifyHrEmail || config.notifyFromEmail,
        subject: `Resume review needed - ${candidate.fullName} - ${candidate.jobTitle}`,
        html: layout("A resume is waiting for review", [
          `<strong>${name}</strong> applied for <strong>${job}</strong>.${escapeHtml(where)}`,
          `Open the dashboard: <a href="${config.appUrl}/admin">${escapeHtml(config.appUrl)}/admin</a>`,
          "Nothing was sent to the candidate beyond the acknowledgement, and nothing was rejected automatically.",
        ]),
        text: [
          "A resume is waiting for review.",
          `${candidate.fullName || "Unknown"} applied for ${candidate.jobTitle}.${where}`,
          `Open the dashboard: ${config.appUrl}/admin`,
          "Nothing was sent to the candidate beyond the acknowledgement, and nothing was rejected automatically.",
        ].join("\n\n"),
      };
    }

    default:
      return null;
  }
}

async function deliver(message: Message): Promise<{ ok: true } | { ok: false; error: string }> {
  const from = config.notifyFromEmail;
  if (!from) return { ok: false, error: "NOTIFY_FROM_EMAIL is not set" };
  if (!message.to) return { ok: false, error: "No recipient address" };

  try {
    if (config.notifyEmailProvider === "resend") {
      if (!config.notifyEmailApiKey) return { ok: false, error: "NOTIFY_EMAIL_API_KEY is not set" };
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.notifyEmailApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: { email: from, name: config.notifyFromName },
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      return response.ok
        ? { ok: true }
        : { ok: false, error: `Resent ${response.status}: ${(await response.text()).slice(0, 300)}` };
    }

    if (config.notifyEmailProvider === "sendgrid") {
      if (!config.notifyEmailApiKey) return { ok: false, error: "NOTIFY_EMAIL_API_KEY is not set" };
      const response = await fetch(SENDGRID_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.notifyEmailApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: from, name: config.notifyFromName },
          subject: message.subject,
          content: [
            { type: "text/plain", value: message.text },
            { type: "text/html", value: message.html },
          ],
        }),
      });
      // SendGrid answers 202 with an empty body on success.
      return response.ok
        ? { ok: true }
        : { ok: false, error: `SendGrid ${response.status}: ${(await response.text()).slice(0, 300)}` };
    }

    return { ok: false, error: `NOTIFY_EMAIL_PROVIDER=${config.notifyEmailProvider || "unset"} is not supported` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Statuses in which the candidate's interview link actually opens something.
 *
 * A link mailed to someone still being screened leads to a page that only says
 * "under review", which reads as a broken promise.
 */
const INTERVIEW_OPEN: ReadonlySet<CandidateStatus> = new Set([
  "profile_pending",
  "ready",
  "in_progress",
  "evaluating",
  "evaluation_failed",
  "completed",
]);

/**
 * Whether this candidate has an interview to open.
 *
 * True once the model shortlisted them *or* once a person advanced them by hand.
 * HR overriding the model is a legitimate outcome, and that candidate is just as
 * entitled to know their interview is open as one the model passed.
 */
export function hasOpenInterview(candidate: Candidate): boolean {
  return INTERVIEW_OPEN.has(candidate.status) || candidate.resumeScreening?.status === "SHORTLISTED";
}

/** True when a provider is configured well enough to attempt a send. */
export function notificationsEnabled(): boolean {
  return (
    (config.notifyEmailProvider === "resend" || config.notifyEmailProvider === "sendgrid") &&
    Boolean(config.notifyEmailApiKey) &&
    Boolean(config.notifyFromEmail)
  );
}

/**
 * Send one notification and record the attempt on the candidate.
 *
 * Resolves either way: callers are screening and registration code paths, and a
 * mail server being down is not a reason to fail an application. The outcome is
 * appended to `candidate.notifications` so HR can see what went out and retry.
 */
export async function notify(
  event: NotificationEvent,
  candidate: Candidate,
  persist: (record: NotificationRecord) => Promise<void>,
): Promise<NotificationRecord> {
  const at = new Date().toISOString();
  const base: NotificationRecord = { event, at, channel: "email", ok: false };

  if (!notificationsEnabled()) {
    // Skipped, not failed: a fresh checkout has no mail configured, and that is
    // a normal state rather than an error to surface on every candidate.
    return { ...base, error: "No email provider configured; notification skipped." };
  }

  const message = buildMessage(event, candidate);
  if (!message) return { ...base, error: `No message template for ${event}` };

  const result = await deliver(message);
  const record: NotificationRecord = result.ok
    ? { ...base, ok: true }
    : { ...base, error: result.error };

  try {
    await persist(record);
  } catch (error) {
    console.error(`[notify] could not record the ${event} notification:`, error);
  }

  if (!result.ok) {
    console.warn(`[notify] ${event} to ${message.to} failed: ${result.error}`);
  }
  return record;
}
