import { requireManager, requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";
import { visibleCandidate } from "@/lib/visibility";

export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireStaff();
  const candidate = await store.getCandidate((await ctx.params).id);
  if (!candidate) throw new HttpError(404, "Candidate not found.");
  return Response.json(await visibleCandidate(me, candidate));
});

/** Manager only: permanently deletes the candidate, their resume and all interview recordings. */
export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireManager();
  if (!(await store.deleteCandidate((await ctx.params).id))) throw new HttpError(404, "Candidate not found.");
  return Response.json({ ok: true });
});
