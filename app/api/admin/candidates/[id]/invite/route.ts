import { decideByHr, issueLoginDetails } from "@/lib/access";
import { requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

export const maxDuration = 120;

/**
 * HR sends login details now: a fresh password and a new window to start. For someone not shortlisted yet (no
 * questions), this shortlists them first. If the email can't be sent, the password is returned once for HR to pass on.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff();
  const { id } = await ctx.params;
  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  if (c.status !== "ready" && c.status !== "rejected") {
    throw new HttpError(409, "This interview has already been started. Use \"Allow re-interview\" instead.");
  }
  const origin = new URL(request.url).origin;
  if (c.status === "rejected" || !c.questions.length) return Response.json(await decideByHr(id, "selected", user.email, origin));
  return Response.json(await issueLoginDetails(id, { origin, showOnFailure: true }));
});
