"use client";

// Real-time proctoring in the browser. Nothing leaves the device except the events it reports.
// Camera checks use Google MediaPipe (face landmarks + object detection) at ~3 checks per second.
import type { FaceLandmarker, NormalizedLandmark, ObjectDetector } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PROCTOR_EVENTS } from "@/lib/proctoring";
import type { ProctorEventType } from "@/lib/types";
import { captureFrame } from "./media";

// Served by this app (downloaded at install by scripts/copy-mediapipe.mjs), with Google's copy as a fallback.
const FACE_MODELS = [
  "/mediapipe/models/face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
];
const OBJECT_MODELS = [
  "/mediapipe/models/efficientdet_lite0.tflite",
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
];
/** Model setup can stall (e.g. GPU init on some machines); never let it block the candidate. */
const LOAD_TIMEOUT_MS = { GPU: 20_000, CPU: 25_000 };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

/** Tries each model URL on GPU, then CPU, each attempt time-limited. */
async function loadFirst<T>(urls: string[], create: (url: string, delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (const delegate of ["GPU", "CPU"] as const) {
    for (const url of urls) {
      try {
        return await withTimeout(create(url, delegate), LOAD_TIMEOUT_MS[delegate]);
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr;
}

const TICK_MS = 330;
/** How long a condition must last before it counts (avoids flagging a blink or a quick glance). */
const SUSTAIN_MS: Partial<Record<ProctorEventType, number>> = {
  face_missing: 3000,
  multiple_faces: 1000,
  looking_away: 3000,
  phone_detected: 1000,
};
/** The same event type is reported at most once per this window. */
const COOLDOWN_MS = 15_000;
const FLASH_MS = 6000;
/** Events that get a webcam snapshot attached. */
const SNAPSHOT_EVENTS = new Set<ProctorEventType>(["face_missing", "multiple_faces", "looking_away", "phone_detected", "left_window", "typing"]);

export type ProctorStatus = "loading" | "ready" | "unavailable";
export type ReportEvent = (type: ProctorEventType, detail: string, snapshot: Blob | null) => void;

/** Head turned sideways or tilted far up/down, from face landmark positions. */
function isLookingAway(lm: NormalizedLandmark[]) {
  const nose = lm[1], left = lm[234], right = lm[454], top = lm[10], chin = lm[152];
  if (!nose || !left || !right || !top || !chin) return false;
  const yaw = (nose.x - left.x) / (right.x - left.x || 1e-6); // ~0.5 facing forward
  const pitch = (nose.y - top.y) / (chin.y - top.y || 1e-6); // ~0.55 facing forward
  return yaw < 0.25 || yaw > 0.75 || pitch < 0.35 || pitch > 0.75;
}

export function useProctor(videoRef: RefObject<HTMLVideoElement | null>) {
  const [status, setStatus] = useState<ProctorStatus>("loading");
  const [faceCount, setFaceCount] = useState<number | null>(null);
  const [liveWarning, setLiveWarning] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const face = useRef<FaceLandmarker | null>(null);
  const objects = useRef<ObjectDetector | null>(null);
  const active = useRef(false);
  const report = useRef<ReportEvent>(() => {});
  const isRecording = useRef<() => boolean>(() => false);
  const since = useRef<Partial<Record<ProctorEventType, number>>>({});
  const lastReported = useRef<Partial<Record<ProctorEventType, number>>>({});
  const phoneHits = useRef(0);
  const tick = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Model loading ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { FilesetResolver, FaceLandmarker, ObjectDetector } = await import("@mediapipe/tasks-vision");
        const fileset = await withTimeout(FilesetResolver.forVisionTasks("/mediapipe/wasm"), LOAD_TIMEOUT_MS.CPU);
        // The face model gates setup; GPU is faster, CPU is the fallback where WebGL is unavailable.
        const f = await loadFirst(FACE_MODELS, (url, delegate) =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: url, delegate },
            runningMode: "VIDEO",
            numFaces: 3,
          }),
        );
        if (cancelled) return f.close();
        face.current = f;
        setStatus("ready");
        // The phone detector is heavier and optional; load it in the background.
        loadFirst(OBJECT_MODELS, (url, delegate) =>
          ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: url, delegate },
            runningMode: "VIDEO",
            scoreThreshold: 0.5,
            categoryAllowlist: ["cell phone"],
          }),
        )
          .then((o) => (cancelled ? o.close() : (objects.current = o)))
          .catch((err) => console.warn("Phone detection unavailable:", err));
      } catch (err) {
        console.error("Proctoring models failed to load:", err);
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      face.current?.close();
      objects.current?.close();
    };
  }, []);

  // ---------- Reporting ----------
  const showFlash = useCallback((text: string) => {
    setFlash(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const emit = useCallback(
    async (type: ProctorEventType, detail: string, opts: { flash?: boolean } = {}) => {
      if (!active.current) return;
      const now = Date.now();
      if (now - (lastReported.current[type] ?? 0) < COOLDOWN_MS) return;
      lastReported.current[type] = now;
      if (opts.flash !== false && PROCTOR_EVENTS[type].warning) showFlash(PROCTOR_EVENTS[type].warning);
      const snap = SNAPSHOT_EVENTS.has(type) && videoRef.current ? await captureFrame(videoRef.current) : null;
      report.current(type, detail, snap);
    },
    [showFlash, videoRef],
  );

  // ---------- Camera checks ----------
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !face.current) return;
      const now = performance.now();
      const result = face.current.detectForVideo(video, now);
      const count = result.faceLandmarks.length;
      setFaceCount((prev) => (prev === count ? prev : count));

      // Phone check once a second (heavier model).
      let phone = false;
      tick.current += 1;
      if (objects.current && tick.current % 3 === 0) {
        const det = objects.current.detectForVideo(video, performance.now());
        phoneHits.current = det.detections.length ? phoneHits.current + 1 : 0;
      }
      phone = phoneHits.current >= 2;

      const conditions: Partial<Record<ProctorEventType, boolean>> = {
        face_missing: count === 0,
        multiple_faces: count > 1,
        looking_away: count === 1 && isLookingAway(result.faceLandmarks[0]),
        phone_detected: phone,
      };

      let warning: string | null = null;
      const wall = Date.now();
      for (const [type, on] of Object.entries(conditions) as [ProctorEventType, boolean][]) {
        if (!on) {
          delete since.current[type];
          continue;
        }
        since.current[type] ??= wall;
        if (wall - since.current[type]! >= (SUSTAIN_MS[type] ?? 0)) {
          warning ??= PROCTOR_EVENTS[type].warning;
          emit(type, `Detected for ${Math.round((wall - since.current[type]!) / 1000)}s`, { flash: false });
        }
      }
      if (!active.current) warning = null;
      setLiveWarning((prev) => (prev === warning ? prev : warning));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [status, emit, videoRef]);

  // ---------- Browser checks ----------
  useEffect(() => {
    const onBlur = () => emit("left_window", "Interview window lost focus");
    const onVisibility = () => document.hidden && emit("left_window", "Switched tab or minimised the browser");
    const onFullscreen = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) emit("fullscreen_exit", "Exited fullscreen", { flash: false });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!active.current) return;
      // Answers are spoken; typing suggests looking something up.
      if (isRecording.current() && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        emit("typing", "Keyboard used while recording an answer");
      }
    };
    const block = (e: Event) => {
      if (!active.current) return;
      e.preventDefault();
      emit("copy_attempt", `Blocked ${e.type}`);
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKey);
    for (const t of ["copy", "cut", "contextmenu"]) document.addEventListener(t, block);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKey);
      for (const t of ["copy", "cut", "contextmenu"]) document.removeEventListener(t, block);
    };
  }, [emit]);

  // ---------- Controls ----------
  const start = useCallback(
    (opts: { report: ReportEvent; isRecording: () => boolean }) => {
      report.current = opts.report;
      isRecording.current = opts.isRecording;
      active.current = true;
      since.current = {};
      if (status === "unavailable") opts.report("proctoring_unavailable", "Camera checks could not load on this device", null);
    },
    [status],
  );

  const stop = useCallback(() => {
    active.current = false;
    setLiveWarning(null);
    setFlash(null);
  }, []);

  return { status, faceCount, warning: liveWarning ?? flash, isFullscreen, start, stop };
}

/**
 * Requests fullscreen; resolves false if the browser refused. Never waits more than 2s, because some
 * browsers leave the request pending; the "Return to fullscreen" overlay covers that case.
 */
export async function enterFullscreen() {
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000));
  const request = document.documentElement.requestFullscreen().then(
    () => true,
    () => false,
  );
  return Promise.race([request, timeout]);
}

/** Chrome/Edge report whether more than one monitor is attached. */
export function hasSecondScreen() {
  return Boolean((window.screen as Screen & { isExtended?: boolean }).isExtended);
}
