import { interviewState } from "@/lib/candidates";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

/** Current interview state for the candidate's page. */
export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = await store.getCandidate((await ctx.params).id);
  if (!c) throw new HttpError(404, "Interview not found.");
  return Response.json(interviewState(c));
});
