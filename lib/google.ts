// The company Google account the app works through: it owns the job application forms, the app reads their
// responses, and (when SMTP isn't set up) interview emails are sent from it with Gmail.
// A Manager connects it once from the dashboard (OAuth); the refresh token is stored encrypted in the database.
// Plain REST calls, no Google SDK.
import crypto from "node:crypto";
import { appSecret } from "./auth";
import { config } from "./config";
import { logger } from "./log";
import { store } from "./store";

const log = logger("google");

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  // Resumes uploaded through the forms are saved in this account's Drive; this downloads them.
  "https://www.googleapis.com/auth/drive.readonly",
];
const FORMS_SCOPES = GOOGLE_SCOPES.filter((s) => s.includes("/forms."));
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

const SETTING_KEY = "google";

interface StoredConnection {
  email: string;
  /** AES-256-GCM, keyed from SESSION_SECRET: "iv.tag.ciphertext" in base64url. */
  refreshToken: string;
  scopes: string[];
  connectedAt: string;
  connectedBy: string;
}

export interface GoogleConnection {
  email: string;
  connectedAt: string;
  connectedBy: string;
  canSendMail: boolean;
  /** Can download resumes uploaded through the forms (connected with Drive permission). */
  canReadDrive: boolean;
}

export const googleConfigured = Boolean(config.google.clientId && config.google.clientSecret);

export class GoogleError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

// ---------- Token encryption ----------

const key = () => crypto.createHash("sha256").update(`google-token:${appSecret()}`).digest();

function encrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function decrypt(stored: string) {
  const [iv, tag, data] = stored.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ---------- Connection ----------

export async function googleConnection(): Promise<GoogleConnection | null> {
  const c = await store.getSetting<StoredConnection>(SETTING_KEY);
  if (!c) return null;
  return {
    email: c.email,
    connectedAt: c.connectedAt,
    connectedBy: c.connectedBy,
    canSendMail: c.scopes.includes(GMAIL_SCOPE),
    canReadDrive: c.scopes.includes(DRIVE_SCOPE),
  };
}

/** Where Google sends the Manager back after they approve. Must be listed in the OAuth client's redirect URIs. */
export const redirectUri = (origin: string) => `${config.appUrl || origin}/api/admin/google/callback`;

export function authUrl(origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // A refresh token, every time, so reconnecting always works.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new GoogleError(`Google sign-in failed: ${data.error_description || data.error || res.status}`, res.status);
  }
  return data;
}

/** Completes the OAuth flow: stores the account and its refresh token. Returns the connected email. */
export async function finishConnect(code: string, origin: string, by: string): Promise<string> {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
  const scopes = (tokens.scope ?? "").split(" ");
  const missing = FORMS_SCOPES.filter((s) => !scopes.includes(s));
  if (missing.length) {
    throw new GoogleError("Please allow access to Google Forms (tick every box on Google's permission screen) and try again.");
  }
  if (!tokens.refresh_token) throw new GoogleError("Google didn't return a long-lived token. Please try connecting again.");
  const info = (await (
    await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
  ).json()) as { email?: string };
  const email = info.email ?? "unknown account";
  await store.setSetting(SETTING_KEY, {
    email,
    refreshToken: encrypt(tokens.refresh_token),
    scopes,
    connectedAt: new Date().toISOString(),
    connectedBy: by,
  } satisfies StoredConnection);
  cached = null;
  log.info(`Connected Google account ${email} (by ${by})`);
  return email;
}

export async function disconnect() {
  const c = await store.getSetting<StoredConnection>(SETTING_KEY);
  if (!c) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(c.refreshToken))}`, { method: "POST" });
  } catch {
    // Removing it here is what matters; the account owner can also revoke it in their Google settings.
  }
  await store.setSetting(SETTING_KEY, null);
  cached = null;
  log.info(`Disconnected Google account ${c.email}`);
}

// ---------- API calls ----------

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const c = await store.getSetting<StoredConnection>(SETTING_KEY);
  if (!c) throw new GoogleError("No Google account is connected. A Manager can connect one in Jobs.");
  let refreshToken: string;
  try {
    refreshToken = decrypt(c.refreshToken);
  } catch {
    throw new GoogleError("The saved Google connection can't be read (was SESSION_SECRET changed?). Please reconnect Google.");
  }
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    cached = { token: t.access_token!, expires: Date.now() + (t.expires_in ?? 3600) * 1000 };
    return cached.token;
  } catch (err) {
    if (err instanceof GoogleError && err.status === 400) {
      throw new GoogleError("Google access was revoked or has expired. A Manager needs to reconnect Google in Jobs.", 401);
    }
    throw err;
  }
}

/**
 * Downloads a Drive file's contents (e.g. a resume uploaded through a form) as the connected account.
 * Throws GoogleError; stops reading past `maxBytes`.
 */
export async function driveDownload(fileId: string, maxBytes: number): Promise<{ buffer: Buffer; contentType: string }> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 && attempt === 0) {
      cached = null;
      continue;
    }
    if (!res.ok) {
      const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
      if (res.status === 403 && /scope/i.test(detail ?? "")) {
        throw new GoogleError("Reconnect Google (Jobs tab) and allow Drive access so uploaded resumes can be read.", 403);
      }
      throw new GoogleError(`Drive download failed: ${detail ?? `HTTP ${res.status}`}`, res.status);
    }
    if (Number(res.headers.get("content-length") || 0) > maxBytes) throw new GoogleError("The resume is larger than 5 MB.");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new GoogleError("The resume is larger than 5 MB.");
    return { buffer, contentType: res.headers.get("content-type") ?? "" };
  }
}

/** Calls a Google REST API as the connected account and returns the parsed JSON. */
export async function googleApi<T>(url: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) {
      cached = null; // token revoked or expired early: refresh once
      continue;
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
      throw new GoogleError(`Google API error: ${msg}`, res.status);
    }
    return data as T;
  }
}
