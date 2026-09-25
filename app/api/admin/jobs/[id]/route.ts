import { requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { parseJob } from "@/lib/jobs";
import { store } from "@/lib/store";

export const PUT = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff();
  const { id } = await ctx.params;
  const existing = (await store.listJobs()).find((j) => j.id === id);
  if (!existing) throw new HttpError(404, "Job not found.");
  const body = await request.json().catch(() => ({}));
  return Response.json(await store.saveJob({ ...parseJob(body, existing), updatedBy: user.email }));
});

/**
 * Removes a job from the list. Candidates who already applied keep their own copy of the job
 * (description and budget), so their interviews and scores are unaffected.
 */
export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  if (!(await store.deleteJob((await ctx.params).id))) throw new HttpError(404, "Job not found.");
  return Response.json({ ok: true });
});
