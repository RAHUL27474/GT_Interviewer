import { candidateLogin, clearCandidateCookie, setCandidateCookie } from "@/lib/access";
import { handler } from "@/lib/http";
import { logger, who } from "@/lib/log";

/** Candidate logs in with the email and password from their interview email. */
export const POST = handler(async (request: Request) => {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const c = await candidateLogin(email, password);
  await setCandidateCookie(c);
  logger("interview").info(`${who(c)} logged in`);
  return Response.json({ id: c.id });
});

export const DELETE = handler(async () => {
  await clearCandidateCookie();
  return Response.json({ ok: true });
});
