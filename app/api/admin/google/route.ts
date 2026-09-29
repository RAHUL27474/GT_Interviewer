import { requireManager } from "@/lib/auth";
import { disconnect } from "@/lib/google";
import { handler } from "@/lib/http";

/** Disconnects the Google account. Existing forms stay in that account; they're just no longer read. */
export const DELETE = handler(async () => {
  await requireManager();
  await disconnect();
  return Response.json({ ok: true });
});
