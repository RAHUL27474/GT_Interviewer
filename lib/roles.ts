// Staff roles and who may manage whom. Shared by the server and the dashboard (no Node imports).
import type { StaffRole } from "./types";

export const ROLES: StaffRole[] = ["hr", "manager", "superadmin"];

export const ROLE_LABEL: Record<StaffRole, string> = {
  hr: "HR",
  manager: "Manager",
  superadmin: "Super Admin",
};

export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  hr: "Candidates (view, videos, resumes, export, re-interview, re-evaluate) and jobs (create, edit, delete).",
  manager: "Everything HR can, plus delete candidates and create/manage HR accounts.",
  superadmin: "Full access: everything a Manager can, plus create/manage Manager and Super Admin accounts.",
};

/** Roles that may delete candidates and open the Team tab. */
export const isManagerOrAbove = (role: StaffRole) => role === "manager" || role === "superadmin";

/** Roles `actor` may create accounts with (or assign to someone). */
export function assignableRoles(actor: StaffRole): StaffRole[] {
  if (actor === "superadmin") return ROLES;
  if (actor === "manager") return ["hr"];
  return [];
}

/** Whether `actor` may edit, reset or deactivate an account that has role `target`. */
export function canManage(actor: StaffRole, target: StaffRole) {
  return assignableRoles(actor).includes(target);
}
