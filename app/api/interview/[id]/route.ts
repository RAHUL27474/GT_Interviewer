import { isCandidateSession } from "@/lib/access";
import { interviewState } from "@/lib/candidates";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

/** Current interview state for the candidate's page (it includes the current question, so login is required). */
export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = await store.getCandidate((await ctx.params).id);
  if (!c) throw new HttpError(404, "Interview not found.");
  if (!(await isCandidateSession(c))) throw new HttpError(401, "Please log in again with the details from your interview email.");
  return Response.json(interviewState(c));
});
