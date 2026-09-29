import { requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { parseJob, syncFormSafely } from "@/lib/jobs";
import { store } from "@/lib/store";

export const PUT = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff();
  const { id } = await ctx.params;
  const existing = (await store.listJobs()).find((j) => j.id === id);
  if (!existing) throw new HttpError(404, "Job not found.");
  const body = await request.json().catch(() => ({}));
  const job = await store.saveJob({ ...parseJob(body, existing), updatedBy: user.email });
  return Response.json({ job, warning: await syncFormSafely(job) });
});

/**
 * Removes a job from the list and stops its Google Form taking responses. Candidates who already applied keep
 * their own copy of the job (description and budget), so their interviews and scores are unaffected.
 */
export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const { id } = await ctx.params;
  const job = (await store.listJobs()).find((j) => j.id === id);
  if (!job) throw new HttpError(404, "Job not found.");
  await syncFormSafely({ ...job, active: false });
  await store.deleteJob(id);
  return Response.json({ ok: true });
});
