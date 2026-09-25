import { requireAdmin } from "@/lib/auth";
import { resetForReinterview } from "@/lib/candidates";
import { handler } from "@/lib/http";

export const maxDuration = 300;

/** HR allows a re-interview: archives this attempt and issues new questions on the same link. */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  await resetForReinterview((await ctx.params).id);
  return Response.json({ ok: true });
});
