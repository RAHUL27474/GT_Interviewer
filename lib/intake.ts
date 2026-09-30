// Turns Google Form responses into candidates. Every FORM_POLL_SECONDS, each open job's form is checked for new
// responses; each one gets its resume read from the pasted link, AI questions, and a login email scheduled
// DECISION_DELAY_MINUTES after it was submitted (lib/access.ts).
import crypto from "node:crypto";
import { newAccess, sendApplicationReceived } from "./access";
import { generateQuestions, resumeToPart, screenResume } from "./ai";
import { config } from "./config";
import { files, resumeKey } from "./files";
import { driveDownload, googleConnection, GoogleError } from "./google";
import { findUploadQuestion, type FormResponse, listResponses, type UploadedFile, uploadedFile } from "./google-forms";
import { logger, who } from "./log";
import { detectType, driveFileId, type FetchedResume, fetchResume, ResumeLinkError } from "./resume-link";
import { decide, screeningRules } from "./screening";
import { JOINING_OPTIONS } from "./scoring";
import { store } from "./store";
import type { Candidate, CandidateProfile, FormField, GoogleJobForm, Job } from "./types";

const log = logger("intake");
const MAX_SKIPPED = 20;

/** Candidate id for a form response: the same response always maps to the same id, so it's never added twice. */
export function responseCandidateId(formId: string, responseId: string) {
  const h = crypto.createHash("sha256").update(`${formId}:${responseId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** First number in free text: "4.5 LPA" -> 4.5, "₹6,00,000" -> 600000. NaN when there is none. */
export function parseNumber(text: string): number {
  const m = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

/** Salaries are asked in lakhs; someone typing 600000 means 6 lakhs. */
export function parseLakhs(text: string): number {
  const n = parseNumber(text);
  return n >= 1000 ? Math.round((n / 100000) * 100) / 100 : n;
}

export type ParsedResponse =
  | { ok: true; profile: CandidateProfile; resumeUrl: string }
  | { ok: false; name: string; reason: string };

/** Reads one response into a candidate profile, or says why it can't be used. */
export function parseResponse(form: GoogleJobForm, jobId: string, r: FormResponse): ParsedResponse {
  const get = (field: FormField) => {
    const qid = form.questionIds[field];
    return (qid && r.answers?.[qid]?.textAnswers?.answers?.[0]?.value?.trim()) || "";
  };
  const name = get("fullName") || "(no name)";
  const email = (form.emailFromSettings ? r.respondentEmail ?? get("email") : get("email")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, name, reason: "No valid email address" };
  const joiningLabel = get("joiningCategory");
  const profile: CandidateProfile = {
    fullName: get("fullName") || email.split("@")[0],
    email,
    phone: get("phone"),
    jobId,
    totalExperience: Math.max(0, parseNumber(get("totalExperience")) || 0),
    currentLocation: get("currentLocation"),
    linkedin: get("linkedin"),
    currentCTC: Math.max(0, parseLakhs(get("currentCTC")) || 0),
    expectedCTC: Math.max(0, parseLakhs(get("expectedCTC")) || 0),
    joiningCategory: JOINING_OPTIONS.find((o) => o.label === joiningLabel)?.value ?? "90_plus",
  };
  return { ok: true, profile, resumeUrl: get("resumeUrl") };
}

/** Downloads a resume stored in Google Drive (uploaded through the form, or a Drive link) via the Drive API. */
async function fromDrive(fileId: string, fileName?: string): Promise<FetchedResume> {
  const { buffer, contentType } = await driveDownload(fileId, config.maxResumeBytes);
  const ext = detectType(buffer, contentType);
  if (!ext) throw new ResumeLinkError("The resume isn't a PDF or Word (.docx) file.");
  return { buffer, ext, fileName: fileName || `resume${ext}` };
}

/**
 * The applicant's resume: the file uploaded in the form, or (older forms) the pasted link. Drive links go through
 * the Drive API when allowed, which also works on networks that block Drive's download server.
 */
async function getResume(upload: UploadedFile | null, resumeUrl: string): Promise<FetchedResume> {
  if (upload) return fromDrive(upload.fileId, upload.fileName);
  const driveId = driveFileId(resumeUrl);
  if (driveId && (await googleConnection())?.canReadDrive) {
    try {
      return await fromDrive(driveId);
    } catch (err) {
      log.warn(`Drive API couldn't read the resume link, trying a direct download:`, err);
    }
  }
  return fetchResume(resumeUrl);
}

/** Creates the candidate for one response. Returns false to stop and retry this response next time (AI down). */
async function intakeResponse(job: Job, form: GoogleJobForm, r: FormResponse, skip: (name: string, reason: string) => void) {
  const id = responseCandidateId(form.formId, r.responseId);
  if (await store.getCandidate(id)) return true; // already added (e.g. by another server)

  const parsed = parseResponse(form, job.id, r);
  if (!parsed.ok) {
    skip(parsed.name, parsed.reason);
    return true;
  }
  const { profile, resumeUrl } = parsed;
  if (await store.hasApplied(profile.email, job.id)) {
    skip(profile.fullName, `${profile.email} has already applied for this job`);
    return true;
  }

  let resume: Candidate["resume"] = null;
  let resumeProblem: string | undefined;
  let resumePart = null;
  const upload = uploadedFile(r, form.uploadQuestionId);
  if (!upload && !resumeUrl) {
    resumeProblem = "No resume was uploaded.";
  } else {
    try {
      const fetched = await getResume(upload, resumeUrl);
      resumePart = await resumeToPart(fetched.buffer, fetched.ext);
      resume = { fileName: fetched.fileName, storedAs: id + fetched.ext };
      await files.put(resumeKey(resume.storedAs), fetched.buffer);
    } catch (err) {
      resume = null;
      resumePart = null;
      resumeProblem =
        err instanceof ResumeLinkError || err instanceof GoogleError
          ? err.message
          : `The resume couldn't be read (${err instanceof Error ? err.message : err}).`;
    }
  }
  if (resumeProblem) log.warn(`${profile.fullName} (${job.title}): ${resumeProblem}`);

  // Screen the resume, then write questions only for those invited to interview.
  let screening;
  let questions: Candidate["questions"] = [];
  try {
    const rating = resumePart ? await screenResume({ job, candidate: profile, resumePart }) : null;
    screening = decide(rating, profile, screeningRules(job, config.defaultPassMark), resumeProblem);
    if (screening.decision === "selected") questions = await generateQuestions({ job, candidate: profile, resumePart });
  } catch (err) {
    log.error(`${profile.fullName} (${job.title}): AI screening or questions failed, will retry:`, err);
    if (resume) await files.remove([resumeKey(resume.storedAs)]).catch(() => {});
    return false;
  }

  const submitted = new Date(r.lastSubmittedTime);
  const candidate: Candidate = {
    id,
    createdAt: submitted.toISOString(),
    ...profile,
    jobTitle: job.title,
    jobSnapshot: { title: job.title, description: job.description, salaryMin: job.salaryMin, salaryMax: job.salaryMax },
    resume,
    resumeUrl: resumeUrl || undefined,
    resumeProblem,
    source: "google_form",
    googleResponseId: r.responseId,
    access: newAccess(submitted),
    screening,
    status: screening.decision === "rejected" ? "rejected" : "ready",
    questions,
    answers: [],
    proctoring: { events: [] },
  };
  try {
    await store.addCandidate(candidate);
  } catch (err) {
    if (await store.getCandidate(id)) return true; // another server added it at the same moment
    throw err;
  }
  log.info(
    `${who(candidate)} applied for "${job.title}" via Google Form: ${screening.decision} ` +
      `(${screening.reasons.join(" ")}); decision email due ${candidate.access!.inviteAt}`,
  );
  await sendApplicationReceived(candidate);
  return true;
}

async function saveForm(jobId: string, patch: Partial<GoogleJobForm>, skipped: GoogleJobForm["skipped"] = []) {
  // Re-read so a job edited in the meantime isn't overwritten.
  const job = (await store.listJobs()).find((j) => j.id === jobId);
  if (!job?.googleForm) return;
  const all = [...skipped, ...(job.googleForm.skipped ?? [])].slice(0, MAX_SKIPPED);
  await store.saveJob({ ...job, googleForm: { ...job.googleForm, ...patch, skipped: all } });
}

/** Reads one job's new responses. */
export async function syncJob(job: Job) {
  if (!job.googleForm) return;
  const form = { ...job.googleForm };
  const skipped: NonNullable<GoogleJobForm["skipped"]> = [];
  const skip = (name: string, reason: string) => {
    skipped.unshift({ at: new Date().toISOString(), name, reason });
    log.warn(`"${job.title}" response from ${name} skipped: ${reason}`);
  };
  let syncedUntil = form.syncedUntil;
  try {
    // The resume upload question is added by hand in Google Forms; look for it until it's there.
    if (!form.uploadQuestionId) {
      const found = await findUploadQuestion(form.formId);
      if (found) {
        form.uploadQuestionId = found;
        log.info(`"${job.title}": resume upload question found`);
      }
    }
    const responses = await listResponses(form.formId, form.syncedUntil);
    for (const r of responses) {
      if (!(await intakeResponse(job, form, r, skip))) break;
      syncedUntil = r.lastSubmittedTime;
    }
    await saveForm(
      job.id,
      { syncedUntil, uploadQuestionId: form.uploadQuestionId, lastCheckedAt: new Date().toISOString(), lastError: undefined },
      skipped,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`"${job.title}" form check failed:`, err);
    await saveForm(
      job.id,
      { syncedUntil, uploadQuestionId: form.uploadQuestionId, lastCheckedAt: new Date().toISOString(), lastError: message },
      skipped,
    );
  }
}

let running = false;

/** Checks every open job's form. Skips quietly when no Google account is connected. */
export async function syncAllForms() {
  if (running) return;
  running = true;
  try {
    if (!(await googleConnection())) return;
    const jobs = (await store.listJobs()).filter((j) => j.active && j.googleForm);
    for (const job of jobs) await syncJob(job);
  } finally {
    running = false;
  }
}

export const formPollMs = () => Math.max(15, config.formPollSeconds) * 1000;
