import { redirect } from "next/navigation";
import { readSignedToken, requireManager } from "@/lib/auth";
import { finishConnect } from "@/lib/google";
import { logger } from "@/lib/log";

/** Google sends the Manager back here after they approve (or cancel). Always ends on the Jobs tab. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let result: string;
  try {
    const user = await requireManager();
    const state = readSignedToken<{ uid: string; purpose: string }>(url.searchParams.get("state") ?? "");
    if (!state || state.purpose !== "google-connect" || state.uid !== user.id) throw new Error("The sign-in link expired. Please try again.");
    const error = url.searchParams.get("error");
    if (error) throw new Error(error === "access_denied" ? "Google access was not allowed." : `Google said: ${error}`);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google didn't return a sign-in code.");
    const email = await finishConnect(code, url.origin, user.email);
    result = `connected=${encodeURIComponent(email)}`;
  } catch (err) {
    logger("google").error("Connecting Google failed:", err);
    result = `google_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`;
  }
  redirect(`/admin?tab=jobs&${result}`);
}
