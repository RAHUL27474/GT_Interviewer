import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { requireStaff } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { mediaDir, store } from "@/lib/store";

const MIME: Record<string, string> = { ".webm": "video/webm", ".mp4": "video/mp4", ".jpg": "image/jpeg" };

/** Streams an answer video or snapshot. Supports Range requests so the video player can seek. */
export const GET = handler(async (request: Request, ctx: { params: Promise<{ id: string; file: string }> }) => {
  await requireStaff();
  const { id, file } = await ctx.params;
  const c = await store.getCandidate(id);
  // Only serve files this candidate's answers actually reference (also blocks path tricks).
  const known =
    c?.answers.some((a) => a.video === file || a.snapshots.includes(file)) ||
    c?.proctoring.events.some((e) => e.snapshot === file) ||
    c?.screenRecording?.segments.some((s) => s.file === file);
  if (!c || !known) throw new HttpError(404, "File not found.");

  const filePath = path.join(mediaDir(id), file);
  const { size } = await fs.stat(filePath);
  const type = MIME[path.extname(file)] ?? "application/octet-stream";

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
  });
});
