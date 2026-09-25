import crypto from "node:crypto";
import { hashPassword, requireManager, toPublic, validateNewPassword } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";
import { visibleTeam } from "@/lib/visibility";
import { assignableRoles, ROLE_LABEL } from "@/lib/roles";
import type { StaffRole } from "@/lib/types";

export const GET = handler(async () => {
  const me = await requireManager();
  return Response.json(visibleTeam(me, await store.listUsers()).map(toPublic));
});

/**
 * Adds an account with a starting password the creator shares with the person.
 * Managers can add HR; Super Admins can add any role.
 */
export const POST = handler(async (request: Request) => {
  const me = await requireManager();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = body.role as StaffRole;
  if (!name) throw new HttpError(400, "Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "A valid email is required.");
  if (!assignableRoles(me.role).includes(role)) {
    throw new HttpError(403, `You can't create ${ROLE_LABEL[role] ?? role} accounts.`);
  }
  const password = validateNewPassword(body.password);

  const user = await store.updateUsers((users) => {
    if (users.some((u) => u.email === email)) throw new HttpError(409, "An account with this email already exists.");
    const u = {
      id: crypto.randomUUID(),
      email,
      name,
      role,
      passwordHash: hashPassword(password),
      active: true,
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
    };
    users.push(u);
    return u;
  });
  return Response.json(toPublic(user));
});
