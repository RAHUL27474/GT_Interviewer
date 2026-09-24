import crypto from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";
import { HttpError } from "./http";

export const ADMIN_COOKIE = "admin_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

function safeEqual(a: string, b: string) {
  const hash = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

/** Cookie value derived from the password, so changing ADMIN_PASSWORD logs everyone out. */
export function sessionToken() {
  return crypto.createHmac("sha256", config.adminPassword).update("admin-session-v1").digest("hex");
}

export function passwordMatches(password: string) {
  return Boolean(config.adminPassword) && safeEqual(password, config.adminPassword);
}

export async function isAdmin() {
  if (!config.adminPassword) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return safeEqual(value, sessionToken());
}

export async function requireAdmin() {
  if (!config.adminPassword) throw new HttpError(503, "Set ADMIN_PASSWORD in .env to enable the dashboard.");
  if (!(await isAdmin())) throw new HttpError(401, "Please sign in again.");
}
