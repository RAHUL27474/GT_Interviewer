// Applications from the careers site: an applicant picks a job, fills in the form and uploads a resume. The
// application is saved straight away (they get an Application ID and a private tracking link), then the AI screens
// the resume in the background, and the decision email follows DECISION_DELAY_MINUTES after applying (lib/access.ts).
import crypto from "node:crypto";
import path from "node:path";
import { newAccess } from "./access";
import { generateQuestions, resumeToPart, screenResume } from "./ai";
import { config } from "./config";
import { files, resumeKey } from "./files";
import { HttpError } from "./http";
import { logger, who } from "./log";
import { decide, screeningRules } from "./screening";
import { JOINING_OPTIONS } from "./scoring";
import { store } from "./store";
import type { Candidate, CandidateProfile, Job } from "./types";

const log = logger("apply");

export const RESUME_TYPES: Record<string, { ext: ".pdf" | ".docx"; mime: string }> = {
  pdf: { ext: ".pdf", mime: "application/pdf" },
  docx: { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

/** The file's real type from its first bytes (never trust the name or the browser's claim). */
export function resumeType(buf: Buffer): (typeof RESUME_TYPES)[string] | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return RESUME_TYPES.pdf;
  // DOCX files are zip archives with a word/ folder.
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from("word/"))) return RESUME_TYPES.docx;
  return null;
}

// No look-alike characters (0/O, 1/I), so the reference can be read out over the phone.
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newApplicationRef() {
  const code = Array.from({ length: 6 }, () => REF_CHARS[crypto.randomInt(REF_CHARS.length)]).join("");
  return `${config.companyName.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "AP"}-${code}`;
}

/** Reads and checks the application form. Throws 400 with every problem listed. */
export function parseApplication(form: FormData, jobId: string): CandidateProfile {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim().slice(0, 300) : "";
  };
  const num = (k: string) => (str(k) === "" ? NaN : Number(str(k)));
  const p: CandidateProfile = {
    fullName: str("fullName"),
    email: str("email").toLowerCase(),
    phone: str("phone"),
    jobId,
    totalExperience: num("totalExperience"),
    currentLocation: str("currentLocation"),
    linkedin: str("linkedin"),
    currentCTC: num("currentCTC"),
    expectedCTC: num("expectedCTC"),
    joiningCategory: str("joiningCategory"),
  };
  const errors: string[] = [];
  if (p.fullName.length < 2) errors.push("Please enter your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.push("Please enter a valid email address.");
  if (!/^[+\d][\d\s-]{7,16}$/.test(p.phone)) errors.push("Please enter a valid phone number.");
  if (!(p.totalExperience >= 0 && p.totalExperience <= 60)) errors.push("Experience must be between 0 and 60 years.");
  if (!p.currentLocation) errors.push("Please enter your current city.");
  if (!(p.currentCTC >= 0 && p.currentCTC < 1000)) errors.push("Current CTC must be in lakhs per year (0 if you're a fresher).");
  if (!(p.expectedCTC >= 0 && p.expectedCTC < 1000)) errors.push("Expected CTC must be in lakhs per year.");
  if (!JOINING_OPTIONS.some((o) => o.value === p.joiningCategory)) errors.push("Please choose when you can join.");
  if (p.linkedin && !/^https?:\/\/\S+$/i.test(p.linkedin)) errors.push("LinkedIn must be a full link starting with https://");
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return p;
}

/** Checks the uploaded resume. Throws 400 with a reason the applicant can act on. */
export async function readResume(file: unknown): Promise<{ buffer: Buffer; ext: ".pdf" | ".docx"; fileName: string }> {
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Please attach your resume.");
  if (file.size > config.maxResumeBytes) throw new HttpError(400, "Your resume must be under 5 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = resumeType(buffer);
  if (!type) throw new HttpError(400, "Your resume must be a PDF or Word (.docx) file.");
  const base = path.basename(file.name).replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "resume";
  return { buffer, ext: type.ext, fileName: base.toLowerCase().endsWith(type.ext) ? base : `${base}${type.ext}` };
}

/**
 * Saves a new application: resume, candidate record (screening pending), Application ID and tracking token.
 * Fast, so the applicant gets an answer straight away; screening happens afterwards (screenApplication).
 */
export async function submitApplication(
  job: Job,
  profile: CandidateProfile,
  resume: { buffer: Buffer; ext: string; fileName: string },
): Promise<Candidate> {
  if (!job.active) throw new HttpError(400, "This position is no longer open.");
  if (await store.hasApplied(profile.email, job.id)) {
    throw new HttpError(
      409,
      "You've already applied for this role with this email. You can follow it with the tracking link from your confirmation email, or on the Track application page.",
    );
  }
  const id = crypto.randomUUID();
  const now = new Date();
  await files.put(resumeKey(id + resume.ext), resume.buffer, RESUME_TYPES[resume.ext.slice(1)]?.mime);
  const candidate: Candidate = {
    id,
    createdAt: now.toISOString(),
    ...profile,
    jobTitle: job.title,
    jobSnapshot: { title: job.title, description: job.description, salaryMin: job.salaryMin, salaryMax: job.salaryMax },
    resume: { fileName: resume.fileName, storedAs: id + resume.ext },
    source: "website",
    applicationRef: newApplicationRef(),
    trackToken: crypto.randomBytes(24).toString("base64url"),
    access: newAccess(now),
    screening: { score: null, decision: "pending", summary: "", strengths: [], gaps: [], reasons: [], at: now.toISOString() },
    status: "ready",
    questions: [],
    answers: [],
    proctoring: { events: [] },
  };
  await store.addCandidate(candidate);
  log.info(`${who(candidate)} applied for "${job.title}" (${candidate.applicationRef}); decision email due ${candidate.access!.inviteAt}`);
  return candidate;
}

/**
 * AI screening for one application: rates the resume, decides, and writes the interview questions for the shortlisted.
 * Throws if the AI fails, leaving the application pending so the next run tries again.
 */
export async function screenApplication(id: string) {
  const c = await store.getCandidate(id);
  if (!c || c.screening?.decision !== "pending") return;
  const job = c.jobSnapshot;
  const rules = screeningRules((await store.listJobs()).find((j) => j.id === c.jobId) ?? {}, config.defaultPassMark);

  let resumePart = null;
  let resumeProblem: string | undefined;
  try {
    if (!c.resume) throw new Error("No resume file was stored.");
    resumePart = await resumeToPart(await files.get(resumeKey(c.resume.storedAs)), path.extname(c.resume.storedAs));
  } catch (err) {
    resumeProblem = `The resume couldn't be read (${err instanceof Error ? err.message : err}).`;
  }
  const rating = resumePart ? await screenResume({ job, candidate: c, resumePart }) : null;
  const screening = decide(rating, c, rules, resumeProblem);
  const questions = screening.decision === "selected" ? await generateQuestions({ job, candidate: c, resumePart }) : [];

  await store.updateCandidate(id, (cand) => {
    if (cand.screening?.decision !== "pending") return; // decided meanwhile (HR, or another run)
    cand.screening = { ...screening, receivedEmailedAt: cand.screening.receivedEmailedAt, receivedEmailError: cand.screening.receivedEmailError };
    cand.questions = questions;
    if (resumeProblem) cand.resumeProblem = resumeProblem;
    if (screening.decision === "rejected") cand.status = "rejected";
  });
  log.info(`${who(c)} screened: ${screening.decision} (${screening.reasons.join(" ")})`);
}

let screening = false;

/**
 * Screens applications still pending (their background screening was cut short, or the AI was down), oldest first,
 * stopping after `budgetMs` so a run fits inside a serverless time limit.
 */
export async function screenPendingApplications(budgetMs = 180_000) {
  if (screening) return;
  screening = true;
  try {
    const deadline = Date.now() + budgetMs;
    // Give the screening started right after applying a head start before picking it up here.
    const cutoff = Date.now() - 2 * 60_000;
    const pending = (await store.listCandidatesByStatus("ready"))
      .filter((c) => c.screening?.decision === "pending" && Date.parse(c.createdAt) <= cutoff)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const c of pending) {
      if (Date.now() > deadline) break;
      try {
        await screenApplication(c.id);
      } catch (err) {
        log.error(`${who(c)}: screening failed, will retry:`, err);
        break; // the AI is likely down: don't hammer it for every applicant
      }
    }
  } finally {
    screening = false;
  }
}

/** The application behind a private tracking link, or null. */
export async function findByTrackToken(token: string): Promise<Candidate | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const all = await store.listCandidates();
  const c = all.find((x) => x.trackToken && x.trackToken.length === token.length && crypto.timingSafeEqual(Buffer.from(x.trackToken), Buffer.from(token)));
  return c ?? null;
}

/** The application for an email + Application ID, or null. */
export async function findByRef(email: string, ref: string): Promise<Candidate | null> {
  const r = ref.trim().toUpperCase();
  return (await store.listCandidatesByEmail(email.trim().toLowerCase())).find((c) => c.applicationRef === r) ?? null;
}
