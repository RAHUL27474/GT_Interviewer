import fs from "node:fs/promises";
import path from "node:path";
import type { Candidate, CandidateStatus, Job, StaffUser } from "../types";

/** What every database backend provides. Deleting files is handled by lib/store.ts. */
export interface Db {
  listCandidates(): Promise<Candidate[]>;
  listCandidatesByStatus(...statuses: CandidateStatus[]): Promise<Candidate[]>;
  getCandidate(id: string): Promise<Candidate | null>;
  listCandidatesByEmail(email: string): Promise<Candidate[]>;
  hasApplied(email: string, jobId: string): Promise<boolean>;
  addCandidate(candidate: Candidate): Promise<void>;
  /** fn mutates the candidate in place, under a lock. Returns the updated candidate, or null if missing. */
  updateCandidate(id: string, fn: (c: Candidate) => void | Promise<void>): Promise<Candidate | null>;
  /** Returns the deleted record, or null if missing. */
  deleteCandidate(id: string): Promise<Candidate | null>;

  listUsers(): Promise<StaffUser[]>;
  saveUser(user: StaffUser): Promise<StaffUser>;
  /** Applies fn to all users under a lock; fn may add, edit or remove users in the array, or throw to abort. */
  updateUsers<R>(fn: (users: StaffUser[]) => R | Promise<R>): Promise<R>;

  listJobs(): Promise<Job[]>;
  saveJob(job: Job): Promise<Job>;
  deleteJob(id: string): Promise<boolean>;

  /** App-wide settings (e.g. the connected Google account), by key; null when unset. */
  getSetting<T>(key: string): Promise<T | null>;
  /** Stores a setting; null removes it. */
  setSetting(key: string, value: unknown): Promise<void>;
}

/** Jobs a brand-new install starts with. */
export async function seedJobs(): Promise<Job[]> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), "config/jobs.seed.json"), "utf8"));
}

/**
 * Upgrades records saved by older versions of the app, in place.
 * Before live proctoring, only a tab-switch count was stored; keep it as a single event.
 */
export function upgrade(c: Candidate): Candidate {
  if (!c.proctoring) {
    const legacy = c as Candidate & { integrity?: { tabSwitches?: number } };
    const switches = legacy.integrity?.tabSwitches ?? 0;
    c.proctoring = {
      events: switches
        ? [
            {
              type: "left_window",
              at: c.completedAt ?? c.createdAt,
              questionIndex: null,
              detail: `${switches} tab switch(es), recorded before live proctoring was added`,
              snapshot: null,
            },
          ]
        : [],
    };
    delete legacy.integrity;
  }
  return c;
}
