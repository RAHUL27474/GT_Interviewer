import { generateQuestions, resumeToPart } from "@/lib/ai";
import { requireAdmin } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { openInterviewOrWaitForDetails } from "@/lib/interview-prep";
import { readStoredObject } from "@/lib/object-storage";
import { notifyInterviewReady } from "@/lib/screening";
import path from "node:path";
import { store } from "@/lib/store";

export const maxDuration = 300;

export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const existing = await store.getCandidate(id);
  if (!existing) throw new HttpError(404, "Candidate not found.");
  if (existing.status !== "awaiting_screening") {
    throw new HttpError(409, "This resume is not waiting for review.");
  }

  const claimed = await store.updateCandidate(id, (candidate) => {
    if (candidate.status !== "awaiting_screening") {
      throw new HttpError(409, "This resume is already being reviewed.");
    }
    candidate.status = "screening";
    delete candidate.screeningError;
  });
  if (!claimed) throw new HttpError(404, "Candidate not found.");

  try {
    if (!existing.profileComplete) {
      const updated = await openInterviewOrWaitForDetails(id);
      if (!updated) throw new HttpError(404, "Candidate not found.");
      await notifyInterviewReady(id);
      return Response.json({ id, status: updated.status });
    }

    const ext = path.extname(existing.resume.storedAs);
    const buffer = await readStoredObject(`resumes/${existing.resume.storedAs}`);
    const questions = await generateQuestions({
      job: existing.jobSnapshot,
      candidate: existing,
      resumePart: await resumeToPart(buffer, ext),
    });
    if (!questions.length) throw new Error("No interview questions were generated.");

    const updated = await store.updateCandidate(id, (candidate) => {
      if (candidate.status !== "screening") throw new HttpError(409, "Review state changed unexpectedly.");
      candidate.questions = questions;
      candidate.status = "ready";
      delete candidate.screeningError;
    });
    if (!updated) throw new HttpError(404, "Candidate not found.");

    // HR has overridden the model, so the candidate's interview is now open. Tell
    // them: they are on the waiting page and will otherwise sit there indefinitely.
    // The template refuses to send unless an interview is genuinely open.
    await notifyInterviewReady(id);

    return Response.json({ id, status: updated.status });
  } catch (err) {
    console.error(`Interview preparation failed for ${id}:`, err);
    await store.updateCandidate(id, (candidate) => {
      if (candidate.status === "screening") {
        candidate.status = "awaiting_screening";
        candidate.screeningError = "Interview preparation failed. Check the resume and try again.";
      }
    });
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "Interview preparation failed. Please try again.");
  }
});
