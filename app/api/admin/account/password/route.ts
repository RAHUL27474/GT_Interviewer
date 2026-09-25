import { hashPassword, requireStaff, setSessionCookie, validateNewPassword, verifyPassword } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

/** Any staff member changes their own password (signs out their other sessions). */
export const POST = handler(async (request: Request) => {
  const me = await requireStaff();
  const { current, next } = (await request.json().catch(() => ({}))) as { current?: string; next?: string };
  if (!verifyPassword(String(current ?? ""), me.passwordHash)) throw new HttpError(400, "Current password is wrong.");
  const password = validateNewPassword(next);
  const updated = await store.updateUsers((users) => {
    const u = users.find((x) => x.id === me.id)!;
    u.passwordHash = hashPassword(password);
    u.sessionVersion += 1;
    return u;
  });
  await setSessionCookie(updated); // keep this browser signed in
  return Response.json({ ok: true });
});
