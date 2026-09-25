import { after } from "next/server";
import { interruptInterview, runEvaluation } from "@/lib/candidates";
import { handler } from "@/lib/http";

export const maxDuration = 300;

/**
 * Auto-submits an in-progress interview as it is. Called by the page when the candidate leaves
 * (via sendBeacon) or reopens the interview link. Safe to call repeatedly.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  // sendBeacon posts the JSON as text/plain, so parse the raw body.
  const body = JSON.parse((await request.text()) || "{}") as { reason?: string };
  const reason = String(body.reason || "The interview was stopped midway").slice(0, 200);
  if (await interruptInterview(id, reason)) after(() => runEvaluation(id));
  return Response.json({ ok: true });
});
