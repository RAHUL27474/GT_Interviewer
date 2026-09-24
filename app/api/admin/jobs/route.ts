import { requireAdmin } from "@/lib/auth";
import { handler } from "@/lib/http";
import { parseJob } from "@/lib/jobs";
import { store } from "@/lib/store";

export const POST = handler(async (request: Request) => {
  await requireAdmin();
  const body = await request.json().catch(() => ({}));
  return Response.json(await store.saveJob(parseJob(body)));
});
