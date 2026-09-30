import crypto from "node:crypto";
import { assertActiveSession } from "@/lib/candidates";
import { directUploads, files, mediaKey } from "@/lib/files";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

const EXT: Record<string, string> = { "video/webm": ".webm", "video/mp4": ".mp4" };

/**
 * A 15-minute link for the browser to upload one answer video straight to the storage bucket (skipping this server,
 * whose host may cap request size). The answer is then submitted with the returned file name.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!directUploads || !files.presignPut) throw new HttpError(400, "Direct uploads are not enabled.");
  const { sessionId, index, type } = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    index?: number;
    type?: string;
  };
  const contentType = String(type ?? "").split(";")[0];
  const ext = EXT[contentType];
  if (!ext) throw new HttpError(400, "Unsupported video format.");

  const c = await store.getCandidate(id);
  if (!c) throw new HttpError(404, "Interview not found.");
  assertActiveSession(c, sessionId);
  if (index !== c.answers.length) throw new HttpError(409, "Answer is out of order.");

  const file = `${index}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const url = await files.presignPut(mediaKey(id, file), contentType, 15 * 60);
  return Response.json({ url, file, contentType });
});
