import { clearSessionCookie, login, setSessionCookie } from "@/lib/auth";
import { handler } from "@/lib/http";

export const POST = handler(async (request: Request) => {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const user = await login(email, password);
  await setSessionCookie(user);
  return Response.json({ ok: true, role: user.role });
});

export const DELETE = handler(async () => {
  await clearSessionCookie();
  return Response.json({ ok: true });
});
