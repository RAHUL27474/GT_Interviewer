import { after } from "next/server";
import { sendApplicationReceived } from "@/lib/access";
import { parseApplication, readResume, screenApplication, submitApplication } from "@/lib/applications";
import { handler, HttpError } from "@/lib/http";
import { logger } from "@/lib/log";
import { store } from "@/lib/store";

export const maxDuration = 300;

// Light abuse protection per server instance: at most 5 applications per address in 10 minutes.
const recent = new Map<string, number[]>();
function rateLimit(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 5) throw new HttpError(429, "Too many applications from this connection. Please try again later.");
  recent.set(ip, [...hits, now]);
}

/** An application from the careers site (multipart form with the resume file). */
export const POST = handler(async (request: Request) => {
  rateLimit(request);
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "The upload didn't complete. Please try again.");
  });
  // Hidden field that people never fill in; bots usually do.
  if (String(form.get("website") ?? "")) return Response.json({ ok: true });

  const jobId = String(form.get("jobId") ?? "");
  const job = (await store.listJobs()).find((j) => j.id === jobId);
  if (!job || !job.active) throw new HttpError(404, "This position is no longer open.");

  const profile = parseApplication(form, job.id);
  const resume = await readResume(form.get("resume"));
  const c = await submitApplication(job, profile, resume);

  // After the reply: the confirmation email, then the AI screening (a later run retries it if this is cut short).
  after(async () => {
    await sendApplicationReceived(c);
    await screenApplication(c.id).catch((err) => logger("apply").error(`${c.fullName}: screening will be retried:`, err));
  });
  return Response.json({ ref: c.applicationRef, trackPath: `/track/${c.trackToken}` });
});
