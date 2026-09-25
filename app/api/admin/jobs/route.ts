import { requireStaff } from "@/lib/auth";
import { handler } from "@/lib/http";
import { parseJob } from "@/lib/jobs";
import { store } from "@/lib/store";

export const POST = handler(async (request: Request) => {
  const user = await requireStaff();
  const body = await request.json().catch(() => ({}));
  return Response.json(await store.saveJob({ ...parseJob(body), updatedBy: user.email }));
});
