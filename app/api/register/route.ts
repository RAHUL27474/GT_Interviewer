import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { generateQuestions, resumeToPart } from "@/lib/ai";
import { config } from "@/lib/config";
import { handler, HttpError } from "@/lib/http";
import { logger, who } from "@/lib/log";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { RESUME_DIR, store } from "@/lib/store";
import type { Candidate, CandidateProfile } from "@/lib/types";

export const maxDuration = 300;

const log = logger("register");

function parseProfile(form: FormData): CandidateProfile {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const num = (k: string) => (str(k) === "" ? NaN : Number(str(k)));
  const p: CandidateProfile = {
    fullName: str("fullName"),
    email: str("email").toLowerCase(),
    phone: str("phone"),
    jobId: str("jobId"),
    totalExperience: num("totalExperience"),
    currentLocation: str("currentLocation"),
    linkedin: str("linkedin"),
    currentCTC: num("currentCTC"),
    expectedCTC: num("expectedCTC"),
    joiningCategory: str("joiningCategory"),
  };
  const errors: string[] = [];
  if (!p.fullName) errors.push("Full name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.push("A valid email is required.");
  if (!/^[+\d][\d\s-]{7,16}$/.test(p.phone)) errors.push("A valid phone number is required.");
  if (!p.jobId) errors.push("Please choose a position.");
  if (!(p.totalExperience >= 0 && p.totalExperience <= 60)) errors.push("Experience must be between 0 and 60 years.");
  if (!(p.currentCTC >= 0)) errors.push("Current CTC is required (enter 0 if fresher).");
  if (!(p.expectedCTC > 0)) errors.push("Expected CTC is required.");
  if (!JOINING_OPTIONS.some((o) => o.value === p.joiningCategory)) errors.push("Please choose when you can join.");
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return p;
}

export const POST = handler(async (request: Request) => {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Upload was incomplete. Please try again.");
  });
  const profile = parseProfile(form);

  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Please upload your resume.");
  const ext = path.extname(file.name).toLowerCase();
  if (!config.resumeTypes.includes(ext)) throw new HttpError(400, "Resume must be a PDF, DOCX or TXT file.");
  if (file.size > config.maxResumeBytes) throw new HttpError(400, "Resume must be under 5 MB.");

  const job = (await store.listJobs()).find((j) => j.id === profile.jobId && j.active);
  if (!job) throw new HttpError(400, "This position is no longer open.");

  const duplicate = (await store.listCandidates()).some((c) => c.email === profile.email && c.jobId === job.id);
  if (duplicate) throw new HttpError(409, "You have already applied for this position with this email.");

  const buffer = Buffer.from(await file.arrayBuffer());
  log.info(`${profile.fullName} applied for "${job.title}" (resume ${ext}, ${(file.size / 1024).toFixed(0)} KB)`);
  let questions;
  try {
    questions = await generateQuestions({ job, candidate: profile, resumePart: await resumeToPart(buffer, ext) });
  } catch (err) {
    log.error(`Could not prepare the interview for ${profile.fullName}:`, err);
    throw new HttpError(502, "We couldn't prepare your interview right now. Please try again in a few minutes.");
  }

  const id = crypto.randomUUID();
  await fs.mkdir(RESUME_DIR, { recursive: true });
  await fs.writeFile(path.join(RESUME_DIR, id + ext), buffer);

  const candidate: Candidate = {
    id,
    createdAt: new Date().toISOString(),
    ...profile,
    jobTitle: job.title,
    jobSnapshot: { title: job.title, description: job.description, salaryMin: job.salaryMin, salaryMax: job.salaryMax },
    resume: { fileName: file.name, storedAs: id + ext },
    status: "ready",
    questions,
    answers: [],
    proctoring: { events: [] },
  };
  await store.addCandidate(candidate);
  log.info(`${who(candidate)} registered with ${questions.length} questions, ready to start`);
  return Response.json({ id });
});
