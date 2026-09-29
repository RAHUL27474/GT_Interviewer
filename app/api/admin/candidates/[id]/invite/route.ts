import { issueLoginDetails } from "@/lib/access";
import { requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

/**
 * HR sends new login details now: a fresh password and a new window to start. If the email can't be sent, the
 * password is returned once so HR can pass it on another way.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const { id } = await ctx.params;
  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  if (c.status !== "ready") throw new HttpError(409, "This interview has already been started. Use \"Allow re-interview\" instead.");
  return Response.json(await issueLoginDetails(id, { origin: new URL(request.url).origin, showOnFailure: true }));
});
