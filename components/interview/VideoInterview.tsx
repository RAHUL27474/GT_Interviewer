"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewState } from "@/lib/types";
import { Alert, Button, Card, cn } from "../ui";
import {
  AnswerRecorder,
  captureFrame,
  pickVideoMimeType,
  speak,
  stopSpeaking,
  uploadWithProgress,
  warmUpVoices,
} from "./media";
import { useCamera } from "./useCamera";
import { useTranscript } from "./useTranscript";

type Phase = "setup" | "asking" | "prep" | "recording" | "uploading" | "done";

/** Seconds into an answer at which a webcam snapshot is taken for proctoring. */
const SNAPSHOT_AT = [3, 30, 90];
/** Stops accidental instant submits. */
const MIN_ANSWER_SECONDS = 5;

type PendingUpload = { form: FormData };

export function VideoInterview({ id, initialState }: { id: string; initialState: InterviewState }) {
  const [state, setState] = useState(initialState);
  const [phase, setPhase] = useState<Phase>(initialState.nextQuestion ? "setup" : "done");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingUpload | null>(null);

  const videoEl = useRef<HTMLVideoElement>(null);
  const recorder = useRef(new AnswerRecorder());
  const snapshots = useRef<Blob[]>([]);
  const tabSwitches = useRef(0);
  const finishing = useRef(false);

  const camera = useCamera();
  const transcript = useTranscript(() =>
    setError("Speech recognition was blocked. Your video is still recorded, but please allow microphone access."),
  );
  // Checked after mount so server and first client render match.
  const [recordingSupported, setRecordingSupported] = useState(true);
  useEffect(() => setRecordingSupported(Boolean(pickVideoMimeType()) && Boolean(navigator.mediaDevices)), []);
  const browserOk = transcript.supported !== false && recordingSupported;

  const q = state.nextQuestion;

  // Tab-switch counter, kept across refreshes of this tab.
  const counterKey = `tabSwitches:${id}`;
  useEffect(() => {
    warmUpVoices();
    try {
      tabSwitches.current = Number(sessionStorage.getItem(counterKey)) || 0;
    } catch {}
  }, [counterKey]);
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden || phase === "setup" || phase === "done") return;
      tabSwitches.current += 1;
      try {
        sessionStorage.setItem(counterKey, String(tabSwitches.current));
      } catch {}
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase, counterKey]);

  // Warn before closing the tab mid-interview.
  useEffect(() => {
    if (phase === "setup" || phase === "done") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  // Attach the camera stream to the preview.
  useEffect(() => {
    if (videoEl.current && camera.stream) videoEl.current.srcObject = camera.stream;
  }, [camera.stream, phase]);

  // Turn the camera off once the interview is over. (Runs on phase change only.)
  useEffect(() => {
    if (phase === "done") {
      stopSpeaking();
      camera.release();
    }
  }, [phase]);

  // ---------- Question flow ----------

  const askQuestion = useCallback(async (text: string) => {
    setPhase("asking");
    await speak(text);
    setSecondsLeft(state.prepSeconds);
    setPhase("prep");
  }, [state.prepSeconds]);

  function startInterview() {
    if (!q) return;
    camera.stopMeter();
    askQuestion(q.text);
  }

  function startRecording() {
    if (!camera.stream) return;
    stopSpeaking();
    snapshots.current = [];
    finishing.current = false;
    recorder.current.start(camera.stream);
    transcript.start();
    setElapsed(0);
    setSecondsLeft(state.minutesPerQuestion * 60);
    setPhase("recording");
  }

  async function finishAnswer() {
    if (finishing.current || !q) return;
    finishing.current = true;
    const [video, text] = await Promise.all([recorder.current.stop(), transcript.stop()]);

    const form = new FormData();
    form.set("index", String(q.index));
    form.set("transcript", text);
    form.set("timeTakenSec", String(elapsed));
    form.set("tabSwitches", String(tabSwitches.current));
    if (video) form.set("video", video, `answer.${video.type.includes("mp4") ? "mp4" : "webm"}`);
    snapshots.current.forEach((s, i) => form.append("snapshots", s, `snap${i}.jpg`));
    await submit({ form });
  }

  async function submit(upload: PendingUpload) {
    setPhase("uploading");
    setProgress(0);
    setError("");
    setPending(null);
    try {
      const res = await uploadWithProgress(`/api/interview/${encodeURIComponent(id)}/answer`, upload.form, setProgress);
      if (!res.ok) throw new Error(String(res.data.error || "Could not save your answer."));
      const next = res.data as unknown as InterviewState;
      setState(next);
      if (next.nextQuestion) askQuestion(next.nextQuestion.text);
      else setPhase("done");
    } catch (err) {
      setPending(upload);
      setError(`${err instanceof Error ? err.message : err} Check your internet connection and try again.`);
    }
  }

  // ---------- Timers ----------

  // The timer effects below re-run once per tick (phase/secondsLeft); the handlers they call
  // read the latest state from that render, so they're deliberately not dependencies.

  // Prep countdown, then recording starts automatically.
  useEffect(() => {
    if (phase !== "prep") return;
    if (secondsLeft <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  // Answer countdown, snapshots, and auto-finish at zero.
  useEffect(() => {
    if (phase !== "recording") return;
    if (SNAPSHOT_AT.includes(elapsed) && videoEl.current) {
      captureFrame(videoEl.current).then((b) => b && snapshots.current.push(b));
    }
    if (secondsLeft <= 0) {
      finishAnswer();
      return;
    }
    const t = setTimeout(() => {
      setSecondsLeft((s) => s - 1);
      setElapsed((e) => e + 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  // ---------- Render ----------

  if (phase === "done") {
    return (
      <Card className="py-12 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-600">✓</div>
        <h1 className="text-2xl font-bold">Thank you!</h1>
        <p className="mx-auto mt-2 max-w-md text-slate-500">
          Your video interview has been submitted. Our hiring team will review it and contact you on your registered email
          or phone if you&apos;re shortlisted.
        </p>
        <p className="mt-4 text-sm text-slate-400">You can close this page now. Your camera has been turned off.</p>
      </Card>
    );
  }

  const mm = Math.floor(Math.max(0, secondsLeft) / 60);
  const ss = String(Math.max(0, secondsLeft) % 60).padStart(2, "0");

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Camera */}
        <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
          {camera.stream ? (
            <video ref={videoEl} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
          ) : (
            <div className="grid size-full place-items-center p-6 text-center text-sm text-slate-400">
              Your camera preview will appear here.
            </div>
          )}
          {phase === "recording" && (
            <>
              <span className="absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
                <span className="size-2 animate-pulse rounded-full bg-red-500" /> REC
              </span>
              <span
                className={cn(
                  "absolute top-3 right-3 rounded-md px-2.5 py-1 font-mono text-sm font-semibold tabular-nums",
                  secondsLeft <= 30 ? "bg-red-600 text-white" : "bg-black/60 text-white",
                )}
              >
                {mm}:{ss}
              </span>
              {transcript.liveText && (
                <p className="absolute inset-x-3 bottom-3 line-clamp-3 rounded-md bg-black/60 px-3 py-2 text-sm text-white">
                  {transcript.liveText}
                </p>
              )}
            </>
          )}
          {phase === "setup" && camera.stream && (
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-md bg-black/60 px-3 py-2 text-xs text-white">
              🎤
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${camera.micLevel * 100}%` }} />
              </div>
              <span>Say something to test your mic</span>
            </div>
          )}
        </div>

        {/* Panel */}
        <Card className="flex flex-col">
          {phase === "setup" ? (
            <SetupPanel
              state={state}
              browserOk={browserOk}
              cameraOn={Boolean(camera.stream)}
              cameraError={camera.error}
              onEnable={camera.enable}
              onStart={startInterview}
            />
          ) : (
            <>
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>
                  Question {q ? q.index + 1 : state.total} of {state.total}
                </span>
                <PhaseBadge phase={phase} />
              </div>
              <div className="mt-3 mb-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-brand-600 transition-all"
                  style={{ width: `${((q?.index ?? state.total) / state.total) * 100}%` }}
                />
              </div>

              <div className="flex gap-3">
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white",
                    phase === "asking" && "animate-pulse ring-4 ring-brand-100",
                  )}
                >
                  AI
                </span>
                <p className="text-lg leading-relaxed font-semibold">{q?.text}</p>
              </div>

              <div className="mt-auto pt-6">
                {phase === "asking" && <p className="text-sm text-slate-500">The interviewer is reading the question…</p>}

                {phase === "prep" && (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">
                      Take a moment to think. Recording starts automatically in{" "}
                      <strong className="tabular-nums">{secondsLeft}s</strong>.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => q && speak(q.text)}>
                        🔊 Replay question
                      </Button>
                      <Button onClick={startRecording} className="flex-1">
                        Start answering now
                      </Button>
                    </div>
                  </div>
                )}

                {phase === "recording" && (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">Speak clearly and look at the camera. Give specific examples.</p>
                    <Button onClick={finishAnswer} disabled={elapsed < MIN_ANSWER_SECONDS} className="w-full">
                      {q && q.index + 1 === state.total ? "Finish interview" : "Finish answer →"}
                    </Button>
                  </div>
                )}

                {phase === "uploading" && (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">{pending ? "Upload failed." : "Saving your answer…"}</p>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress * 100}%` }} />
                    </div>
                    {pending && (
                      <Button onClick={() => submit(pending)} className="w-full">
                        Retry upload
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Partial<Record<Phase, [string, string]>> = {
    asking: ["Listening to question", "bg-brand-50 text-brand-700"],
    prep: ["Thinking time", "bg-amber-50 text-amber-700"],
    recording: ["Recording", "bg-red-50 text-red-700"],
    uploading: ["Saving", "bg-slate-100 text-slate-600"],
  };
  const entry = map[phase];
  if (!entry) return null;
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", entry[1])}>{entry[0]}</span>;
}

function SetupPanel({
  state,
  browserOk,
  cameraOn,
  cameraError,
  onEnable,
  onStart,
}: {
  state: InterviewState;
  browserOk: boolean;
  cameraOn: boolean;
  cameraError: string;
  onEnable: () => void;
  onStart: () => void;
}) {
  if (!browserOk) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Please switch browser</h1>
        <p className="text-sm text-slate-600">
          This video interview needs <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on a laptop or
          desktop. Copy this page&apos;s link and open it there. Your progress is saved.
        </p>
        <Button variant="secondary" onClick={() => navigator.clipboard.writeText(window.location.href)}>
          Copy interview link
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <h1 className="text-xl font-bold">Hi {state.fullName.split(" ")[0]} 👋</h1>
      <p className="mt-1 text-sm text-slate-500">
        Video interview for <strong className="text-slate-800">{state.jobTitle}</strong>
      </p>
      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
        <li>
          {state.total} questions. The AI interviewer reads each one aloud, then you get {state.prepSeconds} seconds to
          think.
        </li>
        <li>You then have up to {state.minutesPerQuestion} minutes to answer on camera. There are no retakes.</li>
        <li>Sit in a quiet, well-lit place, alone, with your face clearly visible.</li>
        <li>Turn your volume up so you can hear the questions.</li>
        <li>Stay on this tab. Switching tabs is recorded.</li>
      </ul>
      {state.answered > 0 && (
        <p className="mt-3 text-sm text-amber-700">You&apos;ve already answered {state.answered}. You&apos;ll continue from question {state.answered + 1}.</p>
      )}
      {cameraError && (
        <div className="mt-4">
          <Alert>{cameraError}</Alert>
        </div>
      )}
      <div className="mt-auto pt-6">
        {cameraOn ? (
          <Button onClick={onStart} className="w-full py-2.5">
            {state.answered > 0 ? "Continue interview" : "Start interview"}
          </Button>
        ) : (
          <Button onClick={onEnable} className="w-full py-2.5">
            Turn on camera &amp; microphone
          </Button>
        )}
      </div>
    </div>
  );
}
