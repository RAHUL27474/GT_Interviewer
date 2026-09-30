import { after } from "next/server";
import { runJobsIfDue } from "@/lib/jobs-runner";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** For load balancers and the Docker HEALTHCHECK: 200 when the app can read its database. */
export async function GET() {
  try {
    await store.listJobs();
    // An uptime monitor pinging this also keeps the background jobs moving (at most once a minute).
    after(runJobsIfDue);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
