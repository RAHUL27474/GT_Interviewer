import { after } from "next/server";
import { requireStaff } from "@/lib/auth";
import { runEvaluation } from "@/lib/candidates";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

export const maxDuration = 300;

export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const { id } = await ctx.params;
  const updated = await store.updateCandidate(id, (c) => {
    if (!["completed", "evaluation_failed"].includes(c.status)) {
      throw new HttpError(409, "Only finished interviews can be re-evaluated.");
    }
    c.status = "evaluating";
  });
  if (!updated) throw new HttpError(404, "Candidate not found.");
  after(() => runEvaluation(id));
  return Response.json({ ok: true });
});
