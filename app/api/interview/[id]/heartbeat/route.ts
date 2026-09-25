import { HttpError, handler } from "@/lib/http";
import { assertActiveSession } from "@/lib/candidates";
import { store } from "@/lib/store";

/** Sent every few seconds by the interview page. Missing heartbeats mean the interview was abandoned. */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: string };
  try {
    const updated = await store.updateCandidate(id, (c) => assertActiveSession(c, sessionId));
    return Response.json({ active: Boolean(updated) });
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return Response.json({ active: false });
    throw err;
  }
});
