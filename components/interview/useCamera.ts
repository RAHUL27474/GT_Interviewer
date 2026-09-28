"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DeviceOption {
  deviceId: string;
  label: string;
}

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true } as const;
const VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } as const;

/**
 * Webcam + microphone stream, with a live mic level (0-1) for the setup check,
 * and the list of devices they came from.
 *
 * Device labels are empty until permission has been granted at least once — that
 * is a browser privacy rule, not an oversight — so the lists are only read after
 * `enable()` succeeds. Before that there is nothing to enumerate anyway.
 */
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);

  /** Turn a device list into something showable, dropping the nameless entries. */
  const readDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const name = (d: MediaDeviceInfo, fallback: string) => d.label || `${fallback} ${d.deviceId.slice(0, 4)}`;
    setCameras(
      all
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({ deviceId: d.deviceId, label: name(d, "Camera") })),
    );
    setMicrophones(
      all
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: name(d, "Microphone") })),
    );
  }, []);

  const acquire = useCallback(
    async (video: MediaTrackConstraints, audio: MediaTrackConstraints) => {
      const s = await navigator.mediaDevices.getUserMedia({ video, audio });
      setStream(s);
      const videoTrack = s.getVideoTracks()[0];
      const audioTrack = s.getAudioTracks()[0];
      if (videoTrack) setCameraId(videoTrack.getSettings().deviceId ?? "");
      if (audioTrack) setMicId(audioTrack.getSettings().deviceId ?? "");

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
      await readDevices();
    },
    [readDevices],
  );

  const friendlyError = (err: unknown): string => {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Camera and microphone access was blocked. Click the padlock or camera icon in your browser's address bar, allow both, then try again.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "We couldn't find a camera and microphone. Plug them in, and check that another app isn't using the camera.";
    }
    if (name === "NotReadableError") {
      return "Your camera or microphone is busy in another app — Zoom, Teams or Meet. Close it and try again.";
    }
    return "We couldn't start your camera. Check that your browser allows camera access, then try again.";
  };

  // Must be called from a click so the browser allows the AudioContext.
  const enable = useCallback(async () => {
    setError("");
    try {
      await acquire(VIDEO_CONSTRAINTS, AUDIO_CONSTRAINTS);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [acquire]);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(raf.current);
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }, []);

  /**
   * Swap to a different camera or microphone.
   *
   * Re-acquires the whole stream rather than calling `setDeviceId` on the
   * existing track: on a stream that is about to be recorded and proctored, a
   * constraint that quietly fails to apply is worse than a clean re-open, and
   * this only happens while the candidate is looking at a device picker.
   */
  const useDevice = useCallback(
    async (kind: "camera" | "mic", deviceId: string) => {
      if (!deviceId) return;
      setError("");
      try {
        const video = kind === "camera" ? { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } } : VIDEO_CONSTRAINTS;
        const audio = kind === "mic" ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } } : AUDIO_CONSTRAINTS;
        stream?.getTracks().forEach((t) => t.stop());
        stopMeter();
        await acquire(video, audio);
      } catch (err) {
        setError(friendlyError(err));
      }
    },
    [acquire, stopMeter, stream],
  );

  const release = useCallback(() => {
    stopMeter();
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }, [stopMeter, stream]);

  useEffect(() => () => stopMeter(), [stopMeter]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  return { stream, error, micLevel, enable, useDevice, stopMeter, release, cameras, microphones, cameraId, micId };
}
