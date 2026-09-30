import path from "node:path";
import { requireStaff } from "@/lib/auth";
import { type FilePart, files, mediaKey, streamParts } from "@/lib/files";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";
import { screenChunkName } from "@/lib/types";

/**
 * Largest response body. Vercel refuses responses over 4.5 MB, so there each reply carries at most 4 MB and the video
 * player fetches the rest as further ranges (which players do anyway).
 */
const MAX_RESPONSE_BYTES = process.env.VERCEL ? 4 * 1024 * 1024 : Infinity;

const MIME: Record<string, string> = { ".webm": "video/webm", ".mp4": "video/mp4", ".jpg": "image/jpeg" };

/** Streams an answer video, snapshot or screen recording. Supports Range requests so the video player can seek. */
export const GET = handler(async (request: Request, ctx: { params: Promise<{ id: string; file: string }> }) => {
  await requireStaff();
  const { id, file } = await ctx.params;
  const c = await store.getCandidate(id);
  // Only serve files this candidate's record actually references (also blocks path tricks).
  const segment = c?.screenRecording?.segments.find((s) => s.file === file);
  const known =
    segment ||
    c?.answers.some((a) => a.video === file || a.snapshots.includes(file)) ||
    c?.proctoring.events.some((e) => e.snapshot === file);
  if (!c || !known) throw new HttpError(404, "File not found.");

  // A screen recording is stored as chunks (or, if saved before cloud storage, one appended file).
  const parts: FilePart[] = segment?.chunkBytes
    ? segment.chunkBytes.map((size, seq) => ({ key: mediaKey(id, screenChunkName(file, seq)), size }))
    : [{ key: mediaKey(id, file), size: await files.size(mediaKey(id, file)).catch(() => -1) }];
  if (parts.some((p) => p.size < 0)) throw new HttpError(404, "File not found.");
  const size = parts.reduce((sum, p) => sum + p.size, 0);
  const type = MIME[path.extname(file)] ?? "application/octet-stream";

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  // A whole file too big for one reply is sent as its first range.
  if ((range && (range[1] || range[2])) || size > MAX_RESPONSE_BYTES) {
    const start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, size - Number(range[2])) : 0;
    const requestedEnd = range?.[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const end = Math.min(requestedEnd, start + MAX_RESPONSE_BYTES - 1);
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(streamParts(parts, { start, end }), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(size ? streamParts(parts, { start: 0, end: size - 1 }) : null, {
    headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
  });
});
