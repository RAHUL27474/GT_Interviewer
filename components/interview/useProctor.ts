"use client";

// Real-time proctoring in the browser. Nothing leaves the device except the events it reports.
// Camera checks use Google MediaPipe (face landmarks + object detection) at ~3 checks per second,
// plus face recognition (face-api) every 1.5 s to catch a different person taking the candidate's place.
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
// Face recognition (@vladmandic/face-api): served by this app, with a CDN copy as a fallback.
const IDENTITY_MODELS = ["/faceapi/models", "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model"];
type FaceApi = typeof import("@vladmandic/face-api");
/** How often the candidate's face is compared with the one enrolled at the start. */
const IDENTITY_MS = 1500;
/** Face descriptors this close are the same person; this far apart are a different person (face-api's scale). */
const SAME_PERSON = 0.5;
const DIFFERENT_PERSON = 0.6;
/** Consecutive non-matching checks (~4.5 s) before it counts, so one bad frame never triggers it. */
const MISMATCH_HITS = 3;
/** Clear, front-facing samples averaged into the candidate's reference face at the start. */
const ENROLL_SAMPLES = 5;

async function loadIdentity(): Promise<FaceApi> {
  const api = await import("@vladmandic/face-api");
  let lastErr: unknown;
  for (const url of IDENTITY_MODELS) {
    try {
      await withTimeout(
        Promise.all([
          api.nets.tinyFaceDetector.loadFromUri(url),
          api.nets.faceLandmark68TinyNet.loadFromUri(url),
          api.nets.faceRecognitionNet.loadFromUri(url),
        ]),
        LOAD_TIMEOUT_MS.CPU,
      );
      return api;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function meanDescriptor(samples: Float32Array[]) {
  const out = new Float32Array(samples[0].length);
  for (const s of samples) for (let i = 0; i < out.length; i++) out[i] += s[i] / samples.length;
  return out;
}

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
/**
 * An episode (e.g. one "looked away") ends only after the condition has been clear this long,
 * so a flicker in detection doesn't turn one long look-away into several.
 */
const RELEASE_MS = 2000;
/** Conditions whose episodes are exposed for the interview's warning rules. */
export type FaceRule = "looking_away" | "multiple_faces" | "different_person";
const NO_EPISODES: Record<FaceRule, boolean> = { looking_away: false, multiple_faces: false, different_person: false };
/** The same event type is reported at most once per this window. */
const COOLDOWN_MS = 15_000;
const FLASH_MS = 6000;
/** Events that get a webcam snapshot attached. */
const SNAPSHOT_EVENTS = new Set<ProctorEventType>(["face_missing", "multiple_faces", "different_person", "looking_away", "phone_detected", "left_window", "typing"]);

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
  /** Right now: more than one person visible (faces or people), without any sustain delay. */
  const [othersVisible, setOthersVisible] = useState(false);
  /** Right now: the face on camera is not the candidate enrolled at the start. */
  const [strangerVisible, setStrangerVisible] = useState(false);
  const [episodes, setEpisodes] = useState<Record<FaceRule, boolean>>(NO_EPISODES);
  const episodeOn = useRef<Record<FaceRule, boolean>>({ ...NO_EPISODES });
  const clearSince = useRef<Partial<Record<FaceRule, number>>>({});

  const face = useRef<FaceLandmarker | null>(null);
  const objects = useRef<ObjectDetector | null>(null);
  const active = useRef(false);
  const report = useRef<ReportEvent>(() => {});
  const isRecording = useRef<() => boolean>(() => false);
  const since = useRef<Partial<Record<ProctorEventType, number>>>({});
  const lastReported = useRef<Partial<Record<ProctorEventType, number>>>({});
  const phoneHits = useRef(0);
  /** Consecutive object-detector checks that saw two or more people. */
  const peopleHits = useRef(0);
  const tick = useRef(0);
  const identityApi = useRef<FaceApi | null>(null);
  const identityBusy = useRef(false);
  const reference = useRef<Float32Array | null>(null);
  const enrollment = useRef<Float32Array[]>([]);
  const mismatchHits = useRef(0);
  const mismatch = useRef(false);
  const lastDistance = useRef(0);
  /** Latest landmark check, so recognition only runs on one clear, front-facing face. */
  const oneFrontFace = useRef(false);
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
            // "person" catches people the face model misses: far away, side-on, partly hidden.
            categoryAllowlist: ["cell phone", "person"],
          }),
        )
          .then((o) => (cancelled ? o.close() : (objects.current = o)))
          .catch((err) => console.warn("Phone detection unavailable:", err));
        // Face recognition is optional too; without it, a person swap is only caught by the AI review.
        loadIdentity()
          .then((api) => {
            if (!cancelled) identityApi.current = api;
          })
          .catch((err) => console.warn("Face recognition unavailable:", err));
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

      // Phone and people check once a second (heavier model).
      tick.current += 1;
      if (objects.current && tick.current % 3 === 0) {
        const det = objects.current.detectForVideo(video, performance.now());
        const cats = det.detections.map((d) => d.categories[0]).filter(Boolean);
        const phones = cats.filter((c) => c.categoryName === "cell phone").length;
        const people = cats.filter((c) => c.categoryName === "person" && c.score >= 0.6).length;
        phoneHits.current = phones ? phoneHits.current + 1 : 0;
        peopleHits.current = people >= 2 ? peopleHits.current + 1 : 0;
      }
      const phone = phoneHits.current >= 2;
      const otherPerson = peopleHits.current >= 2;
      oneFrontFace.current = count === 1 && !otherPerson && !isLookingAway(result.faceLandmarks[0]);

      const conditions: Partial<Record<ProctorEventType, boolean>> = {
        face_missing: count === 0,
        multiple_faces: count > 1 || otherPerson,
        different_person: mismatch.current,
        // A head turned far enough often loses the face entirely, so that counts as looking away too.
        looking_away: count === 0 || (count === 1 && isLookingAway(result.faceLandmarks[0])),
        phone_detected: phone,
      };

      const others = Boolean(conditions.multiple_faces);
      setOthersVisible((prev) => (prev === others ? prev : others));

      let warning: string | null = null;
      const wall = Date.now();
      let episodesChanged = false;
      for (const [type, on] of Object.entries(conditions) as [ProctorEventType, boolean][]) {
        const rule = type in NO_EPISODES ? (type as FaceRule) : null;
        if (!on) {
          delete since.current[type];
          if (rule && episodeOn.current[rule]) {
            clearSince.current[rule] ??= wall;
            if (wall - clearSince.current[rule]! >= RELEASE_MS) {
              episodeOn.current[rule] = false;
              episodesChanged = true;
            }
          }
          continue;
        }
        if (rule) delete clearSince.current[rule];
        since.current[type] ??= wall;
        if (wall - since.current[type]! >= (SUSTAIN_MS[type] ?? 0)) {
          warning ??= PROCTOR_EVENTS[type].warning;
          const detail =
            type === "different_person"
              ? `Face did not match the candidate enrolled at the start (distance ${lastDistance.current.toFixed(2)})`
              : `Detected for ${Math.round((wall - since.current[type]!) / 1000)}s`;
          emit(type, detail, { flash: false });
          if (rule && !episodeOn.current[rule]) {
            episodeOn.current[rule] = true;
            episodesChanged = true;
          }
        }
      }
      if (episodesChanged) setEpisodes({ ...episodeOn.current });
      if (!active.current) warning = null;
      setLiveWarning((prev) => (prev === warning ? prev : warning));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [status, emit, videoRef]);

  // ---------- Identity check ----------
  // Enrolls the candidate's face when the interview starts, then keeps comparing: a different person
  // sitting down (with only one face visible) is caught here, which the face-count checks can't see.
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(async () => {
      const api = identityApi.current;
      const video = videoRef.current;
      if (!api || !video || video.readyState < 2 || !active.current || identityBusy.current || !oneFrontFace.current) return;
      identityBusy.current = true;
      try {
        const found = await api
          .detectSingleFace(video, new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        if (!found || !active.current) return;
        if (!reference.current) {
          enrollment.current.push(found.descriptor);
          if (enrollment.current.length >= ENROLL_SAMPLES) reference.current = meanDescriptor(enrollment.current);
          return;
        }
        const distance = api.euclideanDistance(found.descriptor, reference.current);
        if (distance <= SAME_PERSON) {
          mismatchHits.current = 0;
          mismatch.current = false;
        } else if (distance >= DIFFERENT_PERSON) {
          lastDistance.current = distance;
          mismatchHits.current += 1;
          if (mismatchHits.current >= MISMATCH_HITS) mismatch.current = true;
        }
        setStrangerVisible((prev) => (prev === mismatch.current ? prev : mismatch.current));
      } catch {
        // A failed check is skipped; the next one runs in IDENTITY_MS.
      } finally {
        identityBusy.current = false;
      }
    }, IDENTITY_MS);
    return () => clearInterval(interval);
  }, [status, videoRef]);

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
      // Whoever is on camera when the interview starts is the candidate.
      reference.current = null;
      enrollment.current = [];
      mismatchHits.current = 0;
      mismatch.current = false;
      if (status === "unavailable") opts.report("proctoring_unavailable", "Camera checks could not load on this device", null);
    },
    [status],
  );

  const stop = useCallback(() => {
    active.current = false;
    setLiveWarning(null);
    setFlash(null);
  }, []);

  return {
    status,
    faceCount,
    warning: liveWarning ?? flash,
    isFullscreen,
    episodes,
    othersVisible,
    strangerVisible,
    start,
    stop,
  };
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
