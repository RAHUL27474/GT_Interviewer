import { requireStaff } from "@/lib/auth";
import { handler } from "@/lib/http";
import { attachGoogleForm, parseJob } from "@/lib/jobs";
import { store } from "@/lib/store";
import type { Job } from "@/lib/types";

/** Creates a job, and its Google Form when `createForm` is set. */
export const POST = handler(async (request: Request) => {
  const user = await requireStaff();
  const body = await request.json().catch(() => ({}));
  let job: Job = { ...parseJob(body), updatedBy: user.email };
  let warning: string | undefined;
  if (body.createForm) {
    try {
      job = await attachGoogleForm(job);
    } catch (err) {
      warning = `Job saved, but the Google Form couldn't be created: ${err instanceof Error ? err.message : err}`;
    }
  }
  return Response.json({ job: await store.saveJob(job), warning });
});
