// Super Admin accounts are invisible to HR and Managers: not listed, not named in any record.
import { store } from "./store";
import type { Candidate, Job, StaffUser } from "./types";

const isSuper = (viewer: Pick<StaffUser, "role">) => viewer.role === "superadmin";

async function superAdminEmails() {
  return new Set((await store.listUsers()).filter((u) => u.role === "superadmin").map((u) => u.email));
}

/** Team members this viewer may see. */
export function visibleTeam(viewer: Pick<StaffUser, "role">, users: StaffUser[]) {
  return isSuper(viewer) ? users : users.filter((u) => u.role !== "superadmin");
}

/** Removes a Super Admin's email from "last edited by" on jobs. */
export async function visibleJobs(viewer: Pick<StaffUser, "role">, jobs: Job[]): Promise<Job[]> {
  if (isSuper(viewer)) return jobs;
  const hidden = await superAdminEmails();
  return jobs.map((j) => (j.updatedBy && hidden.has(j.updatedBy) ? { ...j, updatedBy: undefined } : j));
}

/** Removes a Super Admin's email from re-interview records. */
export async function visibleCandidate(viewer: Pick<StaffUser, "role">, c: Candidate): Promise<Candidate> {
  if (isSuper(viewer) || !c.attempts?.length) return c;
  const hidden = await superAdminEmails();
  return {
    ...c,
    attempts: c.attempts.map((a) => (a.archivedBy && hidden.has(a.archivedBy) ? { ...a, archivedBy: undefined } : a)),
  };
}
