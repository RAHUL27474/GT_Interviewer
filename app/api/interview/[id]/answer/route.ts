import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { after } from "next/server";
import { assertActiveSession, interviewState, runEvaluation } from "@/lib/candidates";
import { config } from "@/lib/config";
import { handler, HttpError } from "@/lib/http";
import { mediaDir, store } from "@/lib/store";

export const maxDuration = 300;

const VIDEO_EXT: Record<string, string> = { "video/webm": ".webm", "video/mp4": ".mp4" };

/** Accepts one answer: the recorded video, its speech-to-text transcript, and webcam snapshots. */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const form = await request.formData();
  const index = Number(form.get("index"));
  const sessionId = form.get("sessionId");

  // Check before writing any files; re-checked under the store lock below.
  const current = await store.getCandidate(id);
  if (!current) throw new HttpError(404, "Interview not found.");
  assertActiveSession(current, sessionId);
  if (index !== current.answers.length) throw new HttpError(409, "Answer is out of order.");

  const video = form.get("video");
  const snapshots = form.getAll("snapshots").slice(0, config.snapshotsPerAnswer);
  const dir = mediaDir(id);
  await fs.mkdir(dir, { recursive: true });
  // Random suffix so a duplicate submission can never overwrite a saved answer's files.
  const base = `${index}-${crypto.randomBytes(4).toString("hex")}`;
  const written: string[] = [];

  try {
    let videoName: string | null = null;
    if (video instanceof File && video.size > 0) {
      const ext = VIDEO_EXT[video.type.split(";")[0]];
      if (!ext) throw new HttpError(400, "Unsupported video format.");
      if (video.size > config.maxVideoBytes) throw new HttpError(400, "Video is too large.");
      videoName = base + ext;
      await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, videoName), Buffer.from(await video.arrayBuffer()));
      written.push(videoName);
    }

    const snapshotNames: string[] = [];
    for (const [n, snap] of snapshots.entries()) {
      if (!(snap instanceof File) || snap.type !== "image/jpeg" || snap.size > config.maxSnapshotBytes) continue;
      const name = `${base}-snap${n}.jpg`;
      await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), Buffer.from(await snap.arrayBuffer()));
      written.push(name);
      snapshotNames.push(name);
    }

    let finished = false;
    const updated = await store.updateCandidate(id, (c) => {
      assertActiveSession(c, sessionId);
      if (index !== c.answers.length) throw new HttpError(409, "Answer is out of order.");
      c.answers.push({
        transcript: String(form.get("transcript") ?? "").slice(0, config.maxTranscriptChars),
        timeTakenSec: Math.max(0, Math.round(Number(form.get("timeTakenSec")) || 0)),
        submittedAt: new Date().toISOString(),
        video: videoName,
        snapshots: snapshotNames,
      });
      if (c.answers.length === c.questions.length) {
        c.status = "evaluating";
        c.completedAt = new Date().toISOString();
        delete c.sessionId;
        finished = true;
      }
    });
    if (!updated) throw new HttpError(404, "Interview not found.");

    // Grade after the response is sent, so the candidate isn't kept waiting.
    if (finished) after(() => runEvaluation(id));
    return Response.json(interviewState(updated));
  } catch (err) {
    await Promise.all(written.map((name) => fs.rm(path.join(/*turbopackIgnore: true*/ dir, name), { force: true })));
    throw err;
  }
});
