import { requireManager, signedToken } from "@/lib/auth";
import { authUrl, googleConfigured } from "@/lib/google";

/** Manager clicks "Connect Google": sends them to Google's permission screen (or back to Jobs with the problem). */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  try {
    const user = await requireManager();
    if (!googleConfigured) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
    // Ties Google's reply to this staff member, and expires, so it can't be forged or replayed later.
    const state = signedToken({ uid: user.id, purpose: "google-connect" }, 10 * 60);
    return Response.redirect(authUrl(origin, state), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.redirect(`${origin}/admin?tab=jobs&google_error=${encodeURIComponent(message)}`, 302);
  }
}
