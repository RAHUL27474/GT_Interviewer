import { cookies } from "next/headers";
import { ADMIN_COOKIE, passwordMatches, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";
import { config } from "@/lib/config";
import { handler, HttpError } from "@/lib/http";

export const POST = handler(async (request: Request) => {
  if (!config.adminPassword) throw new HttpError(503, "Set ADMIN_PASSWORD in .env to enable the dashboard.");
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!passwordMatches(String(password ?? ""))) throw new HttpError(401, "Wrong password.");

  (await cookies()).set(ADMIN_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ ok: true });
});

export const DELETE = handler(async () => {
  (await cookies()).delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
});
