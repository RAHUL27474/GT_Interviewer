import crypto from "node:crypto";
import { assertActiveSession } from "@/lib/candidates";
import { config } from "@/lib/config";
import { files, mediaKey } from "@/lib/files";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";
import { screenChunkName } from "@/lib/types";

/**
 * Receives the screen recording in ~10 s chunks while the interview runs, storing each as its own file
 * (played back as one video by the media route). Chunks of one segment arrive in order (seq 0, 1, 2…); a new segment starts each
 * time the candidate re-shares their screen. Uploading as we go means an interrupted interview
 * still keeps its screen recording up to that point.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Upload was incomplete. Please try again.");
  });
  const sessionId = form.get("sessionId");
  const segment = Number(form.get("segment"));
  const seq = Number(form.get("seq"));
  const chunk = form.get("chunk");
  if (!(chunk instanceof File) || !Number.isInteger(segment) || !Number.isInteger(seq) || segment < 0 || seq < 0) {
    throw new HttpError(400, "Invalid screen chunk.");
  }
  if (chunk.size > config.maxScreenChunkBytes) throw new HttpError(400, "Screen chunk too large.");
  const data = Buffer.from(await chunk.arrayBuffer());

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
        chunkBytes: [],
      });
    }
    const seg = segments[segment];
    if (!seg) throw new HttpError(409, "Unknown screen segment.");
    if (seq < seg.chunks) {
      duplicate = true; // a retried upload that already landed
      return;
    }
    if (seq > seg.chunks) throw new HttpError(409, "Screen chunk out of order.");
    // Each chunk is its own file (buckets can't append); saved under the record lock so they stay in order.
    await files.put(mediaKey(id, screenChunkName(seg.file, seq)), data, "video/webm");
    seg.chunks += 1;
    seg.bytes += data.length;
    (seg.chunkBytes ??= []).push(data.length);
  });
  if (!updated) throw new HttpError(404, "Interview not found.");
  return Response.json({ ok: true, duplicate });
});
