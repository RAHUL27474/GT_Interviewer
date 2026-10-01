import { findByRef } from "@/lib/applications";
import { loginLimiter } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";

const limiter = loginLimiter();

/** Finds an application by email + Application ID and returns its private tracking link. */
export const POST = handler(async (request: Request) => {
  const { email, ref } = (await request.json().catch(() => ({}))) as { email?: string; ref?: string };
  const key = String(email ?? "").trim().toLowerCase();
  if (!key || !ref) throw new HttpError(400, "Enter the email you applied with and your Application ID.");
  limiter.check(key);
  const c = await findByRef(key, String(ref));
  if (!c?.trackToken) {
    limiter.fail(key);
    throw new HttpError(404, "We couldn't find an application with that email and Application ID.");
  }
  limiter.succeed(key);
  return Response.json({ trackPath: `/track/${c.trackToken}` });
});
