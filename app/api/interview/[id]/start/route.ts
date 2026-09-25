import { interviewState, newSessionId } from "@/lib/candidates";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

/**
 * Starts the interview and issues a session id. From here on, leaving the page, refreshing,
 * or losing connection auto-submits the interview instead of letting it resume.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { secondScreen, fullscreen, screenShared } = (await request.json().catch(() => ({}))) as {
    secondScreen?: boolean;
    fullscreen?: boolean;
    screenShared?: boolean;
  };
  // Required before an interview can begin (the page also enforces this before calling us).
  if (!fullscreen) throw new HttpError(400, "The interview can only start in fullscreen.");
  if (!screenShared) throw new HttpError(400, "Please share your entire screen to start the interview.");
  const sessionId = newSessionId();

  const updated = await store.updateCandidate(id, (c) => {
    if (c.status !== "ready") throw new HttpError(409, "This interview has already been started.");
    const now = new Date().toISOString();
    c.status = "in_progress";
    c.sessionId = sessionId;
    c.startedAt = now;
    c.lastSeenAt = now;
    if (secondScreen) {
      c.proctoring.events.push({
        type: "second_screen",
        at: now,
        questionIndex: null,
        detail: "More than one monitor was connected when the interview started.",
        snapshot: null,
      });
    }
  });
  if (!updated) throw new HttpError(404, "Interview not found.");
  return Response.json({ sessionId, state: interviewState(updated) });
});
