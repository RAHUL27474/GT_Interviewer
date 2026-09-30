import { decideByHr } from "@/lib/access";
import { requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";

export const maxDuration = 120;

/** HR overrides the resume screening: { decision: "selected" | "rejected" }. The decision email goes out now. */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff();
  const { decision } = (await request.json().catch(() => ({}))) as { decision?: string };
  if (decision !== "selected" && decision !== "rejected") throw new HttpError(400, "Choose selected or rejected.");
  return Response.json(await decideByHr((await ctx.params).id, decision, user.email, new URL(request.url).origin));
});
