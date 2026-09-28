import { handler, HttpError } from "@/lib/http";
import { prepareQuestionsAndMarkReady } from "@/lib/interview-prep";
import { parseDetailsForm } from "@/lib/profile";
import { store } from "@/lib/store";

export const maxDuration = 300;

export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const existing = await store.getCandidate(id);
  if (!existing) throw new HttpError(404, "Interview not found.");
  if (existing.status !== "profile_pending") {
    throw new HttpError(409, "These details can only be submitted after your resume is shortlisted.");
  }

  const details = parseDetailsForm(await request.formData());
  const duplicate = (await store.listCandidates()).some(
    (c) => c.id !== id && c.email === details.email && c.jobId === existing.jobId && c.profileComplete,
  );
  if (duplicate) throw new HttpError(409, "You have already applied for this position with this email.");

  const saved = await store.updateCandidate(id, (candidate) => {
    if (candidate.status !== "profile_pending") {
      throw new HttpError(409, "These details can only be submitted after your resume is shortlisted.");
    }
    Object.assign(candidate, details);
    candidate.profileComplete = true;
  });
  if (!saved) throw new HttpError(404, "Interview not found.");

  try {
    const updated = await prepareQuestionsAndMarkReady(id, "profile_pending");
    if (!updated) throw new HttpError(404, "Interview not found.");
    return Response.json({ id, status: updated.status });
  } catch (err) {
    await store.updateCandidate(id, (candidate) => {
      if (candidate.status === "profile_pending" && candidate.profileComplete) {
        candidate.screeningError = "Interview questions could not be prepared. Please try submitting again.";
      }
    });
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "Could not prepare your interview. Please try again.");
  }
});
