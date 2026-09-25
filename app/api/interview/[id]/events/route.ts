import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertActiveSession } from "@/lib/candidates";
import { config } from "@/lib/config";
import { handler, HttpError } from "@/lib/http";
import { logger, who } from "@/lib/log";
import { PROCTOR_EVENT_TYPES } from "@/lib/proctoring";
import { mediaDir, store } from "@/lib/store";
import type { ProctorEventType } from "@/lib/types";

/** Records one live proctoring event (with an optional webcam snapshot) as it happens. */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Upload was incomplete. Please try again.");
  });
  const sessionId = form.get("sessionId");
  const type = String(form.get("type")) as ProctorEventType;
  if (!PROCTOR_EVENT_TYPES.includes(type)) throw new HttpError(400, "Unknown event type.");

  const current = await store.getCandidate(id);
  if (!current) throw new HttpError(404, "Interview not found.");
  assertActiveSession(current, sessionId);
  if (current.proctoring.events.length >= config.maxProctorEvents) return Response.json({ ok: true, capped: true });

  let snapshot: string | null = null;
  const snap = form.get("snapshot");
  if (snap instanceof File && snap.type === "image/jpeg" && snap.size > 0 && snap.size <= config.maxSnapshotBytes) {
    const dir = mediaDir(id);
    await fs.mkdir(dir, { recursive: true });
    snapshot = `event-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.jpg`;
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, snapshot), Buffer.from(await snap.arrayBuffer()));
  }

  const q = form.get("questionIndex");
  const detail = String(form.get("detail") ?? "").slice(0, 300);
  logger("proctor").warn(
    `${who(current)} ${type}${q === null || q === "" ? "" : ` on question ${Number(q) + 1}`}${detail ? `: ${detail}` : ""}`,
  );
  await store.updateCandidate(id, (c) => {
    assertActiveSession(c, sessionId);
    c.proctoring.events.push({
      type,
      at: new Date().toISOString(),
      questionIndex: q === null || q === "" ? null : Number(q),
      detail,
      snapshot,
    });
  });
  return Response.json({ ok: true });
});
