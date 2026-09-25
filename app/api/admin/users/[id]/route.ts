import { hashPassword, requireManager, toPublic, validateNewPassword } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";
import { assignableRoles, canManage, ROLE_LABEL } from "@/lib/roles";
import type { StaffRole } from "@/lib/types";

/**
 * Edits an account: name, role, active, or a password reset.
 * Managers can only manage HR accounts; Super Admins can manage anyone.
 * Guard rails: you can't change your own role or deactivate yourself, and there must always be
 * at least one active Super Admin.
 */
export const PATCH = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireManager();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const user = await store.updateUsers((users) => {
    const u = users.find((x) => x.id === id);
    // Super Admin accounts are invisible to everyone else: respond as if it doesn't exist.
    if (!u || (u.role === "superadmin" && me.role !== "superadmin")) throw new HttpError(404, "Account not found.");
    const isSelf = u.id === me.id;
    // Other people's accounts need permission over their role (your own role/status is blocked below).
    if (!isSelf && !canManage(me.role, u.role)) throw new HttpError(403, `You can't manage ${ROLE_LABEL[u.role]} accounts.`);

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new HttpError(400, "Name is required.");
      u.name = name;
    }
    if (body.role !== undefined && body.role !== u.role) {
      if (isSelf) throw new HttpError(400, "You can't change your own role.");
      if (!assignableRoles(me.role).includes(body.role as StaffRole)) {
        throw new HttpError(403, `You can't give someone the ${ROLE_LABEL[body.role as StaffRole] ?? String(body.role)} role.`);
      }
      u.role = body.role as StaffRole;
    }
    if (body.active !== undefined && Boolean(body.active) !== u.active) {
      if (isSelf) throw new HttpError(400, "You can't deactivate your own account.");
      u.active = Boolean(body.active);
      u.sessionVersion += 1; // sign them out everywhere
      // Starts (or cancels) the automatic-deletion countdown.
      if (u.active) delete u.deactivatedAt;
      else u.deactivatedAt = new Date().toISOString();
    }
    if (body.password !== undefined) {
      u.passwordHash = hashPassword(validateNewPassword(body.password));
      u.sessionVersion += 1;
    }
    if (!users.some((x) => x.role === "superadmin" && x.active)) {
      throw new HttpError(400, "There must always be at least one active Super Admin.");
    }
    return u;
  });
  return Response.json(toPublic(user));
});
