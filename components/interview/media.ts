"use client";

// Browser media helpers for the video interview: text-to-speech, recording, snapshots, upload.

let cachedVoice: SpeechSynthesisVoice | null = null;

/** Loads TTS voices early; some browsers populate them asynchronously. */
export function warmUpVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const pick = () => {
    const voices = speechSynthesis.getVoices();
    cachedVoice =
      voices.find((v) => v.lang === "en-IN") ??
      voices.find((v) => v.lang === "en-GB") ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null;
  };
  pick();
  speechSynthesis.addEventListener("voiceschanged", pick);
}

/** Reads text aloud. Resolves when finished (or after a safety timeout). */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (cachedVoice) u.voice = cachedVoice;
    u.rate = 0.95;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
    // Some browsers never fire onend; don't leave the candidate stuck.
    setTimeout(finish, Math.max(8000, text.length * 100));
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

export function pickVideoMimeType() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

export class AnswerRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  start(stream: MediaStream) {
    this.chunks = [];
    const mimeType = pickVideoMimeType();
    // Modest bitrate: ~6 MB per minute, clear enough for HR review.
    this.recorder = new MediaRecorder(stream, {
      ...(mimeType && { mimeType }),
      videoBitsPerSecond: 700_000,
      audioBitsPerSecond: 64_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType.split(";")[0] || "video/webm" }));
      rec.stop();
    });
  }
}

/** Small JPEG of the current camera frame (for AI proctoring notes). */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.6));
}

/** multipart POST with upload progress (fetch can't report upload progress). */
export function uploadWithProgress(
  url: string,
  body: FormData,
  onProgress: (fraction: number) => void,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.onerror = () => reject(new Error("Network error while uploading."));
    xhr.send(body);
  });
}
