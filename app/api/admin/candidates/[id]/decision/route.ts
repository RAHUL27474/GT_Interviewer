import { requireAdmin } from "@/lib/auth";
import { setDecision } from "@/lib/candidates";
import { handler, HttpError } from "@/lib/http";
import type { HrDecision } from "@/lib/types";

const OUTCOMES: HrDecision[] = ["selected", "rejected"];

/** HR records a hire decision. `outcome: null` clears an earlier one. */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { outcome } = (await request.json().catch(() => ({}))) as { outcome?: unknown };
  if (outcome !== null && !OUTCOMES.includes(outcome as HrDecision)) {
    throw new HttpError(400, "Outcome must be 'selected', 'rejected', or null.");
  }
  await setDecision((await ctx.params).id, outcome as HrDecision | null);
  return Response.json({ ok: true });
});
