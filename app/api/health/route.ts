import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/** For load balancers and the Docker HEALTHCHECK: 200 when the app can read its database. */
export async function GET() {
  try {
    await store.listJobs();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
