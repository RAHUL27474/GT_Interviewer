import { requireAdmin } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const candidate = await store.getCandidate((await ctx.params).id);
  if (!candidate) throw new HttpError(404, "Candidate not found.");
  return Response.json(candidate);
});
