// Staff accounts (HR and Manager) with email + password, and signed session cookies.
// Applicants never sign in: their private interview link is their access.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";
import { HttpError } from "./http";
import { store } from "./store";
import type { PublicStaffUser, StaffRole, StaffUser } from "./types";

export const SESSION_COOKIE = "staff_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours
export const MIN_PASSWORD_LENGTH = 8;


// ---------- Passwords ----------

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function validateNewPassword(password: unknown): string {
  const p = String(password ?? "");
  if (p.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return p;
}

export function toPublic(u: StaffUser): PublicStaffUser {
  const { passwordHash: _h, sessionVersion: _v, ...rest } = u;
  if (!u.active && u.deactivatedAt) {
    const deletesAt = new Date(new Date(u.deactivatedAt).getTime() + config.accountDeleteAfterDays * 86_400_000);
    return { ...rest, deletesAt: deletesAt.toISOString() };
  }
  return rest;
}

/**
 * Permanently deletes accounts that have been deactivated for longer than ACCOUNT_DELETE_AFTER_DAYS.
 * Accounts deactivated before this rule existed get their countdown started now.
 * Returns the emails that were deleted.
 */
export async function purgeDeactivatedAccounts(): Promise<string[]> {
  const cutoff = Date.now() - config.accountDeleteAfterDays * 86_400_000;
  return store.updateUsers((users) => {
    const deleted: string[] = [];
    for (let i = users.length - 1; i >= 0; i--) {
      const u = users[i];
      if (u.active) continue;
      if (!u.deactivatedAt) {
        u.deactivatedAt = new Date().toISOString();
        continue;
      }
      if (new Date(u.deactivatedAt).getTime() <= cutoff) {
        deleted.push(u.email);
        users.splice(i, 1);
      }
    }
    return deleted;
  });
}

// ---------- Sessions ----------

function secret() {
  // Set SESSION_SECRET in production; otherwise derive one so it works out of the box.
  return process.env.SESSION_SECRET || crypto.createHash("sha256").update(`session:${config.adminPassword}`).digest("hex");
}

const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function sessionTokenFor(user: StaffUser) {
  const payload = Buffer.from(
    JSON.stringify({ uid: user.id, v: user.sessionVersion, exp: Date.now() + SESSION_MAX_AGE * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): { uid: string; v: number; exp: number } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: StaffUser) {
  (await cookies()).set(SESSION_COOKIE, sessionTokenFor(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

// ---------- First account ----------

/**
 * On a fresh install there are no accounts: create the first Super Admin from SUPER_ADMIN_EMAIL +
 * ADMIN_PASSWORD so someone can sign in and add the rest of the team.
 */
export async function ensureFirstSuperAdmin() {
  if (!config.adminPassword) return;
  await store.updateUsers((users) => {
    if (users.length) return;
    users.push({
      id: crypto.randomUUID(),
      email: config.superAdminEmail,
      // "anita.sharma@…" -> "Anita Sharma"
      name: config.superAdminEmail
        .split("@")[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ") || "Super Admin",
      role: "superadmin",
      passwordHash: hashPassword(config.adminPassword),
      active: true,
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
    });
  });
}

// ---------- Current user ----------

export async function getCurrentUser(): Promise<StaffUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const data = token ? readToken(token) : null;
  if (!data) return null;
  const user = (await store.listUsers()).find((u) => u.id === data.uid);
  // Deactivated users and sessions from before a password reset are rejected.
  if (!user || !user.active || user.sessionVersion !== data.v) return null;
  return user;
}

/** Throws 401 if not signed in, 403 if signed in without one of `roles`. */
export async function requireStaff(roles: StaffRole[] = ["hr", "manager", "superadmin"]): Promise<StaffUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Please sign in again.");
  if (!roles.includes(user.role)) {
    throw new HttpError(403, roles.includes("manager") ? "Only a Manager or Super Admin can do this." : "Only a Super Admin can do this.");
  }
  return user;
}

/** Manager or Super Admin. */
export const requireManager = () => requireStaff(["manager", "superadmin"]);

// ---------- Login ----------

// Simple in-memory brute-force protection: 5 failures per email locks it for 10 minutes.
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60 * 1000;

export async function login(emailInput: unknown, password: unknown): Promise<StaffUser> {
  await ensureFirstSuperAdmin();
  if (!(await store.listUsers()).length) {
    throw new HttpError(503, "No accounts yet. Set SUPER_ADMIN_EMAIL and ADMIN_PASSWORD in .env to create the first Super Admin.");
  }
  const email = String(emailInput ?? "").trim().toLowerCase();
  const f = failures.get(email);
  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
    throw new HttpError(429, "Too many failed attempts. Try again in 10 minutes.");
  }
  const user = (await store.listUsers()).find((u) => u.email === email);
  if (!user || !verifyPassword(String(password ?? ""), user.passwordHash)) {
    const next = { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + LOCK_MS };
    failures.set(email, next);
    throw new HttpError(401, "Wrong email or password.");
  }
  if (!user.active) throw new HttpError(403, "This account has been deactivated. Contact your manager.");
  failures.delete(email);
  const updated = { ...user, lastLoginAt: new Date().toISOString() };
  await store.saveUser(updated);
  return updated;
}

export { verifyPassword };
