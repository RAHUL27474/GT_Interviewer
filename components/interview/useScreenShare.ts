"use client";

import { useEffect, useRef, useState } from "react";

const CHUNK_MS = 10_000;
/** Low bitrate: screens are mostly static text, ~2 MB per minute is plenty to review. */
const SCREEN_BITRATE = 300_000;

function pickScreenMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/**
 * Entire-screen sharing plus a chunked recording of it for the whole interview.
 * Chunks upload in order as they are produced, so an interrupted interview keeps what was recorded.
 */
export function useScreenShare(onStopped: () => void) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const segment = useRef(-1);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const target = useRef<{ url: string; sessionId: string } | null>(null);
  const intentionalStop = useRef(false);
  const stoppedCb = useRef(onStopped);
  stoppedCb.current = onStopped;

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function uploadChunk(seg: number, seq: number, blob: Blob) {
    const t = target.current;
    if (!t) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const form = new FormData();
        form.set("sessionId", t.sessionId);
        form.set("segment", String(seg));
        form.set("seq", String(seq));
        form.set("chunk", blob, "chunk.webm");
        const res = await fetch(t.url, { method: "POST", body: form });
        if (res.ok || res.status === 409) return; // 409: interview already ended, nothing to retry
      } catch {
        // network blip: retry
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  function startSegment(s: MediaStream) {
    segment.current += 1;
    const seg = segment.current;
    let seq = 0;
    const mimeType = pickScreenMimeType();
    const rec = new MediaRecorder(s, { ...(mimeType && { mimeType }), videoBitsPerSecond: SCREEN_BITRATE });
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const n = seq++;
      // Chain uploads so the server receives chunks strictly in order.
      queue.current = queue.current.then(() => uploadChunk(seg, n, e.data));
    };
    rec.start(CHUNK_MS);
    recorder.current = rec;
  }

  /** Asks the candidate to share their entire screen. Must be called from a click. */
  async function share(): Promise<boolean> {
    setError("");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: { ideal: 5, max: 10 } },
        audio: false,
        // Chrome/Edge hints: offer whole screens, hide this tab, no switching mid-share.
        monitorTypeSurfaces: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
      const track = s.getVideoTracks()[0];
      const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
      if (surface && surface !== "monitor") {
        s.getTracks().forEach((t) => t.stop());
        setError('Please choose "Entire screen", not a window or a tab.');
        return false;
      }
      intentionalStop.current = false;
      track.addEventListener("ended", () => {
        setStream(null);
        recorder.current = null;
        if (!intentionalStop.current) stoppedCb.current();
      });
      setStream(s);
      // Re-sharing mid-interview starts a new recording segment.
      if (target.current) startSegment(s);
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Screen sharing was cancelled or blocked. Sharing your entire screen is required for this interview."
          : "Could not start screen sharing. Please try again in Chrome or Edge.",
      );
      return false;
    }
  }

  /** Starts recording the shared screen and uploading it to `url` for this interview session. */
  function startRecording(url: string, sessionId: string) {
    target.current = { url, sessionId };
    if (stream) startSegment(stream);
  }

  /** Stops sharing; resolves once the last chunk has been uploaded. */
  async function stop() {
    intentionalStop.current = true;
    const rec = recorder.current;
    recorder.current = null;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    await queue.current;
    target.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  return { stream, error, share, startRecording, stop };
}
