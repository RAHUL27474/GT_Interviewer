import { requireStaff } from "@/lib/auth";
import { GoogleError } from "@/lib/google";
import { handler, HttpError } from "@/lib/http";
import { attachGoogleForm } from "@/lib/jobs";
import { store } from "@/lib/store";

export const maxDuration = 60;

/** Creates the Google Form for an existing job. */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff();
  const { id } = await ctx.params;
  const job = (await store.listJobs()).find((j) => j.id === id);
  if (!job) throw new HttpError(404, "Job not found.");
  try {
    return Response.json({ job: await store.saveJob({ ...(await attachGoogleForm(job)), updatedBy: user.email }) });
  } catch (err) {
    if (err instanceof GoogleError) throw new HttpError(502, err.message);
    throw err;
  }
});
