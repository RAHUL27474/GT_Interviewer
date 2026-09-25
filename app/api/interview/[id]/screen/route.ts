import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertActiveSession } from "@/lib/candidates";
import { config } from "@/lib/config";
import { handler, HttpError } from "@/lib/http";
import { mediaDir, store } from "@/lib/store";

/**
 * Receives the screen recording in ~10 s chunks while the interview runs, appending each to its
 * segment's file. Chunks of one segment arrive in order (seq 0, 1, 2…); a new segment starts each
 * time the candidate re-shares their screen. Uploading as we go means an interrupted interview
 * still keeps its screen recording up to that point.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const form = await request.formData();
  const sessionId = form.get("sessionId");
  const segment = Number(form.get("segment"));
  const seq = Number(form.get("seq"));
  const chunk = form.get("chunk");
  if (!(chunk instanceof File) || !Number.isInteger(segment) || !Number.isInteger(seq) || segment < 0 || seq < 0) {
    throw new HttpError(400, "Invalid screen chunk.");
  }
  if (chunk.size > config.maxScreenChunkBytes) throw new HttpError(400, "Screen chunk too large.");
  const data = Buffer.from(await chunk.arrayBuffer());
  const dir = mediaDir(id);
  await fs.mkdir(dir, { recursive: true });

  let duplicate = false;
  const updated = await store.updateCandidate(id, async (c) => {
    assertActiveSession(c, sessionId);
    const segments = (c.screenRecording ??= { segments: [] }).segments;
    if (segment === segments.length && seq === 0) {
      segments.push({
        file: `screen-${segment}-${crypto.randomBytes(3).toString("hex")}.webm`,
        startedAt: new Date().toISOString(),
        chunks: 0,
        bytes: 0,
      });
    }
    const seg = segments[segment];
    if (!seg) throw new HttpError(409, "Unknown screen segment.");
    if (seq < seg.chunks) {
      duplicate = true; // a retried upload that already landed
      return;
    }
    if (seq > seg.chunks) throw new HttpError(409, "Screen chunk out of order.");
    // Appended under the store lock, so chunks can never interleave.
    await fs.appendFile(path.join(/*turbopackIgnore: true*/ dir, seg.file), data);
    seg.chunks += 1;
    seg.bytes += data.length;
  });
  if (!updated) throw new HttpError(404, "Interview not found.");
  return Response.json({ ok: true, duplicate });
});
