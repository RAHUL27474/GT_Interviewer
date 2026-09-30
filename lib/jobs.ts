import crypto from "node:crypto";
import { config } from "./config";
import { googleConnection } from "./google";
import { createJobForm, syncJobForm } from "./google-forms";
import { HttpError } from "./http";
import { logger } from "./log";
import type { Job } from "./types";

export function parseJob(body: Record<string, unknown>, existing?: Job): Job {
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!title || !description) throw new HttpError(400, "Title and description are required.");
  const optNum = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const salaryMin = optNum(body.salaryMin);
  const salaryMax = optNum(body.salaryMax);
  if ([salaryMin, salaryMax].some((n) => n !== null && !(n >= 0))) throw new HttpError(400, "Salary must be a positive number.");
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) throw new HttpError(400, "Salary min is above max.");
  const passMark = optNum(body.passMark);
  const minExperience = optNum(body.minExperience);
  if (passMark !== null && !(passMark >= 0 && passMark <= 100)) throw new HttpError(400, "Pass mark must be between 0 and 100.");
  if (minExperience !== null && !(minExperience >= 0)) throw new HttpError(400, "Minimum experience must be a positive number.");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: existing?.id ?? `${slug}-${crypto.randomBytes(3).toString("hex")}`,
    title,
    location: String(body.location ?? "").trim(),
    description,
    salaryMin,
    salaryMax,
    active: body.active !== false,
    googleForm: existing?.googleForm,
    // Left empty in the form: the job uses RESUME_PASS_MARK.
    screening: passMark === null && minExperience === null ? undefined : { passMark: passMark ?? config.defaultPassMark, minExperience },
  };
}

/** Creates the job's Google Form. Returns the job with the form attached. */
export async function attachGoogleForm(job: Job): Promise<Job> {
  if (job.googleForm) throw new HttpError(409, "This job already has a Google Form.");
  const google = await googleConnection();
  if (!google) throw new HttpError(400, "Connect a Google account first (Jobs tab).");
  return { ...job, googleForm: await createJobForm(job, google.email) };
}

/**
 * Pushes job edits (title, description, open/closed) to its Google Form. Never throws: the job itself is saved
 * either way; returns a warning for HR if the form couldn't be updated.
 */
export async function syncFormSafely(job: Job): Promise<string | undefined> {
  if (!job.googleForm) return;
  try {
    await syncJobForm(job);
  } catch (err) {
    logger("forms").warn(`Couldn't update the form for "${job.title}":`, err);
    return `Job saved, but its Google Form couldn't be updated (${err instanceof Error ? err.message : err}). Edit the form in Google Forms if needed.`;
  }
}
