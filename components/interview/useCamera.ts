"use client";

import { useEffect, useRef, useState } from "react";

/** Webcam + microphone stream, with a live mic level (0-1) for the setup check. */
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);

  // Must be called from a click so the browser allows the AudioContext.
  async function enable() {
    setError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setStream(s);

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      audioCtx.current = ctx;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setMicLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera/microphone permission was denied. Click the camera icon in the address bar, allow access, then try again."
          : name === "NotFoundError"
            ? "No camera or microphone was found. Please connect one and try again."
            : "Could not start the camera. Close other apps that may be using it (Zoom, Teams…) and try again.",
      );
    }
  }

  function stopMeter() {
    cancelAnimationFrame(raf.current);
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }

  function release() {
    stopMeter();
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  useEffect(() => () => stopMeter(), []);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  return { stream, error, micLevel, enable, stopMeter, release };
}
