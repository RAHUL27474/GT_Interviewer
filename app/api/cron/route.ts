import crypto from "node:crypto";
import { runScheduledJobs } from "@/lib/jobs-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** True if the request carries CRON_SECRET, as "Authorization: Bearer <secret>" (Vercel Cron) or ?key=<secret>. */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(request.url).searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Runs the background jobs: new form applications, decision emails, stale interviews, stuck gradings, cleanup.
 * Called every minute by an external scheduler (e.g. cron-job.org) on hosts without an always-on server.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "Set CRON_SECRET to enable this endpoint." }, { status: 503 });
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const steps = await runScheduledJobs();
  return Response.json({ ok: steps.every((s) => s.ok), steps }, { status: steps.every((s) => s.ok) ? 200 : 500 });
}
