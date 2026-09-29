import { issueLoginDetails } from "@/lib/access";
import { requireStaff } from "@/lib/auth";
import { resetForReinterview } from "@/lib/candidates";
import { handler } from "@/lib/http";

export const maxDuration = 300;

/**
 * HR allows a re-interview: archives this attempt, issues new questions, and emails new login details straight
 * away (a fresh password and a new window to start).
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff();
  const { id } = await ctx.params;
  await resetForReinterview(id, user.email);
  const result = await issueLoginDetails(id, { reinterview: true, origin: new URL(request.url).origin, showOnFailure: true });
  return Response.json({ ok: true, ...result });
});
