import { requireAdmin } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { parseJob } from "@/lib/jobs";
import { store } from "@/lib/store";

export const PUT = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const existing = (await store.listJobs()).find((j) => j.id === id);
  if (!existing) throw new HttpError(404, "Job not found.");
  const body = await request.json().catch(() => ({}));
  return Response.json(await store.saveJob(parseJob(body, existing)));
});
