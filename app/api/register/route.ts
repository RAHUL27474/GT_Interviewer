import crypto from "node:crypto";
import path from "node:path";
import { config } from "@/lib/config";
import { handler, HttpError } from "@/lib/http";
import { writeStoredObject } from "@/lib/object-storage";
import { parseApplicationDetails, EMPTY_DETAILS } from "@/lib/profile";
import { notify } from "@/lib/notify";
import { enqueueResumeScreening } from "@/lib/screening-queue";
import { markScreeningFailed, processResumeScreening } from "@/lib/screening";
import { store } from "@/lib/store";
import type { Candidate } from "@/lib/types";

export const maxDuration = 300;

export const POST = handler(async (request: Request) => {
  const form = await request.formData();
  const jobIdValue = form.get("jobId");
  const jobId = typeof jobIdValue === "string" ? jobIdValue.trim() : "";
  if (!jobId) throw new HttpError(400, "Please choose a position.");

  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Please upload your resume.");
  const ext = path.extname(file.name).toLowerCase();
  if (!config.resumeTypes.includes(ext)) throw new HttpError(400, "Resume must be a PDF, DOCX or TXT file.");
  if (file.size > config.maxResumeBytes) throw new HttpError(400, "Resume must be under 5 MB.");

  const job = (await store.listJobs()).find((j) => j.id === jobId && j.active);
  if (!job) throw new HttpError(400, "This position is no longer open.");

  const details = parseApplicationDetails(form);
  // Every applicant blocks a second one for the same role, shortlisted or not.
  // Keying this on `profileComplete` would let someone apply, wait, and apply
  // again with the same email while their first application is still pending.
  const duplicate = (await store.listCandidates()).some(
    (c) => c.email === details.email && c.jobId === job.id,
  );
  if (duplicate) throw new HttpError(409, "You have already applied for this position with this email.");

  const buffer = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();
  await writeStoredObject(`resumes/${id}${ext}`, buffer);

  const candidate: Candidate = {
    id,
    createdAt: new Date().toISOString(),
    ...details,
    ...EMPTY_DETAILS,
    jobId: job.id,
    jobTitle: job.title,
    jobSnapshot: { title: job.title, description: job.description, salaryMin: job.salaryMin, salaryMax: job.salaryMax },
    resume: { fileName: file.name, storedAs: id + ext },
    // False is the point: screening runs on the resume, and the rest of the
    // details are collected only if it clears the bar. openInterviewOrWaitForDetails
    // reads this flag to route a shortlisted candidate to profile_pending.
    profileComplete: false,
    status: "screening",
    questions: [],
    answers: [],
    proctoring: { events: [] },
  };
  await store.addCandidate(candidate);

  // Acknowledgement first, so the candidate has confirmation even if screening
  // is slow or the mail provider is down. It is deliberately neutral: no score,
  // no verdict, and no promise about the outcome.
  try {
    await notify("application_received", candidate, async (record) => {
      await store.updateCandidate(id, (current) => {
        current.notifications = [...(current.notifications ?? []), record].slice(-20);
      });
    });
  } catch (error) {
    console.warn(`[register] acknowledgement for ${id} did not complete:`, error);
  }

  // Screening must not hold up the response.
  //
  // With a queue this is one push, so awaiting it is free and a broken Redis
  // surfaces here rather than silently. Without one, the only thing that can run
  // screening is this process, and the first candidate would pay the Python
  // bridge's model load inside their own submit: about 30 seconds of staring at a
  // spinner before the page they were promised. The candidate lands on
  // ResumeScreenWaiting, which polls every few seconds for as long as the status
  // is "screening", so backgrounding it here is exactly what that page is built
  // to expect.
  //
  // The trade-off is durability. In-process work does not survive the process
  // being killed, so a crash mid-screening leaves the candidate in "screening"
  // until someone uses the admin "run screening" action. Run Redis and the worker
  // in production; this branch is the single-process fallback.
  const screen = async (): Promise<void> => {
    try {
      if (config.redisUrl) await enqueueResumeScreening(id);
      else await processResumeScreening(id);
    } catch (err) {
      console.error(`Could not run resume screening for ${id}:`, err);
      await markScreeningFailed(id, err);
    }
  };

  if (config.redisUrl) await screen();
  else void screen();

  return Response.json({ id, status: candidate.status });
});
