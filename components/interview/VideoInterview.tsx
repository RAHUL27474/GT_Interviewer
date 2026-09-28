"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewState, ProctorEventType } from "@/lib/types";
import { PRE_INTERVIEW_STEPS } from "@/lib/invite";
import { Alert, Button, Card, cn, inputClass, Spinner, StepProgress } from "../ui";
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
import { enterFullscreen, hasSecondScreen, useProctor } from "./useProctor";
import { useAwayGuard } from "./useAwayGuard";
import { useScreenShare } from "./useScreenShare";
import { useTranscript } from "./useTranscript";

type Phase = "setup" | "asking" | "prep" | "recording" | "uploading" | "done" | "interrupted";

/** Phases during which the interview is live (leaving the page ends it). */
const LIVE: Phase[] = ["asking", "prep", "recording", "uploading"];
/** Seconds into an answer at which a webcam snapshot is taken for the AI proctoring review. */
const SNAPSHOT_AT = [3, 30, 90];
/** Stops accidental instant submits. */
const MIN_ANSWER_SECONDS = 5;
const VOICE_CLIENT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 10_000;

export function VideoInterview({ id, initialState }: { id: string; initialState: InterviewState }) {
  const [state, setState] = useState(initialState);
  const [phase, setPhase] = useState<Phase>(
    initialState.interrupted || initialState.status === "in_progress"
      ? "interrupted"
      : initialState.nextQuestion
        ? "setup"
        : "done",
  );
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [pendingForm, setPendingForm] = useState<FormData | null>(null);
  const [secondScreen, setSecondScreen] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(true);

  const videoEl = useRef<HTMLVideoElement>(null);
  const recorder = useRef(new AnswerRecorder());
  const snapshots = useRef<Blob[]>([]);
  const sessionId = useRef<string | null>(null);
  const voiceConversationId = useRef<string | null>(null);
  const voiceRequestGeneration = useRef(0);
  const pendingVoiceReply = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const finishing = useRef(false);

  const api = `/api/interview/${encodeURIComponent(id)}`;
  const camera = useCamera();
  const proctor = useProctor(videoEl);
  const transcript = useTranscript(() =>
    setError("Speech recognition was blocked. Your video is still recorded, but please allow microphone access."),
  );
  const onScreenStopped = useRef<() => void>(() => {});
  const screen = useScreenShare(() => onScreenStopped.current());
  const browserOk = transcript.supported !== false && recordingSupported;
  const q = state.nextQuestion;

  // Checked after mount so server and first client render match.
  useEffect(() => {
    warmUpVoices();
    setRecordingSupported(
      Boolean(pickVideoMimeType()) && Boolean(navigator.mediaDevices?.getDisplayMedia),
    );
    setSecondScreen(hasSecondScreen());
  }, []);

  // Reopening the link mid-interview (refresh, new tab, came back later) submits it as it is.
  useEffect(() => {
    if (initialState.status !== "in_progress") return;
    fetch(`${api}/interrupt`, {
      method: "POST",
      body: JSON.stringify({ reason: "The interview page was refreshed or reopened" }),
    })
      .then(() => fetch(api))
      .then((r) => r.json())
      .then((s: InterviewState) => setState(s))
      .catch(() => {});
  }, [api, initialState.status]);

  // Attach the camera stream to the preview.
  useEffect(() => {
    if (videoEl.current && camera.stream) videoEl.current.srcObject = camera.stream;
  }, [camera.stream, phase]);

  // ---------- Ending ----------

  const shutDown = useCallback(() => {
    stopSpeaking();
    proctor.stop();
    recorder.current.stop();
    transcript.stop();
    screen.stop();
    camera.release();
    if (sessionId.current) {
      void fetch(`${api}/voice`, {
        method: "DELETE",
        headers: { "x-interview-session-id": sessionId.current },
      }).catch(() => {});
    }
    voiceRequestGeneration.current += 1;
    voiceConversationId.current = null;
    pendingVoiceReply.current = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [api, proctor, transcript, camera, screen]);

  /** Server says the interview is no longer live (auto-submitted after an interruption). */
  const handleInterrupted = useCallback(async () => {
    if (phaseRef.current === "interrupted" || phaseRef.current === "done") return;
    shutDown();
    try {
      setState(await (await fetch(api)).json());
    } catch {}
    setPhase("interrupted");
  }, [api, shutDown]);

  useEffect(() => {
    if (phase === "done") shutDown();
    // Runs on phase change only; shutDown is stable enough for this one-off.
  }, [phase]);

  // Heartbeat: if it stops (closed tab, crash, lost connection) the server auto-submits the interview.
  // Depends only on whether the interview is live, so the per-second timer re-renders never reset it.
  const handleInterruptedRef = useRef(handleInterrupted);
  handleInterruptedRef.current = handleInterrupted;
  const live = LIVE.includes(phase);

  // Leaving the tab or fullscreen: warnings first, then the interview is submitted as it is.
  const [resharing, setResharing] = useState(false);
  const guard = useAwayGuard({
    active: live,
    graceSeconds: state.awayGraceSeconds,
    maxWarnings: state.maxWarnings,
    paused: resharing,
    onTerminate: async (reason) => {
      try {
        await fetch(`${api}/interrupt`, { method: "POST", body: JSON.stringify({ reason }) });
      } catch {
        // If this fails the heartbeat timeout still ends the interview on the server.
      }
      handleInterruptedRef.current();
    },
  });
  useEffect(() => {
    if (!live) return;
    const beat = async () => {
      try {
        const res = await fetch(`${api}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId.current }),
        });
        if (!(await res.json()).active) handleInterruptedRef.current();
      } catch {
        // Offline: keep trying. If it lasts, the server will auto-submit.
      }
    };
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [live, api]);

  // Leaving the page mid-interview submits it immediately.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (LIVE.includes(phaseRef.current)) e.preventDefault();
    };
    const onPageHide = () => {
      if (!LIVE.includes(phaseRef.current)) return;
      navigator.sendBeacon(
        `${api}/interrupt`,
        JSON.stringify({ reason: "The candidate closed, refreshed or left the interview page" }),
      );
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [api]);

  // ---------- Proctoring events ----------

  // The proctor keeps the reporter it was started with, so read the current question from a ref.
  const questionIndex = useRef<number | null>(null);
  questionIndex.current = state.nextQuestion?.index ?? null;
  const reportEvent = useCallback(
    (type: ProctorEventType, detail: string, snapshot: Blob | null) => {
      if (!sessionId.current) return;
      const form = new FormData();
      form.set("sessionId", sessionId.current);
      form.set("type", type);
      form.set("detail", detail);
      if (questionIndex.current !== null) form.set("questionIndex", String(questionIndex.current));
      if (snapshot) form.set("snapshot", snapshot, "event.jpg");
      fetch(`${api}/events`, { method: "POST", body: form }).catch(() => {});
    },
    [api],
  );
  onScreenStopped.current = () => {
    if (LIVE.includes(phaseRef.current)) reportEvent("screen_share_stopped", "Candidate stopped sharing their screen", null);
  };

  // ---------- Question flow ----------

  const askQuestion = useCallback(
    async (text: string) => {
      setPhase("asking");
      await speak(text);
      if (phaseRef.current !== "asking") return;
      setSecondsLeft(state.prepSeconds);
      setPhase("prep");
    },
    [state.prepSeconds],
  );

  async function startInterview() {
    if (!q) return;
    setError("");
    // Hard requirements: the interview never starts without both, whatever state the UI is in.
    if (!screen.stream) return setError("Please share your entire screen first.");
    if (!document.fullscreenElement && !(await enterFullscreen())) {
      return setError("The interview can only start in fullscreen. Click \"Enter fullscreen\" and allow it.");
    }
    camera.stopMeter();
    try {
      const res = await fetch(`${api}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secondScreen,
          fullscreen: Boolean(document.fullscreenElement),
          screenShared: Boolean(screen.stream?.active),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the interview.");
      sessionId.current = data.sessionId;
      setState(data.state);
      screen.startRecording(`${api}/screen`, data.sessionId);
    } catch (err) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    proctor.start({ report: reportEvent, isRecording: () => phaseRef.current === "recording" });
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

  async function requestVoiceReply(transcript: string, questionIndex: number): Promise<string | null> {
    const activeSessionId = sessionId.current;
    if (!activeSessionId || !transcript.trim()) return null;
    const requestGeneration = ++voiceRequestGeneration.current;
    const requestedConversationId = voiceConversationId.current;
    const request = (async (): Promise<string | null> => {
      try {
        const response = await fetch(`${api}/voice`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-interview-session-id": activeSessionId,
          },
          body: JSON.stringify({
            conversation_id: requestedConversationId ?? undefined,
            question_index: questionIndex,
            transcript,
            response_audio: false,
          }),
        });
        if (response.status === 409) {
          // A stale request must not clear a newer turn's server binding.
          if (
            sessionId.current === activeSessionId
            && voiceRequestGeneration.current === requestGeneration
            && voiceConversationId.current === requestedConversationId
          ) {
            voiceConversationId.current = null;
          }
          return null;
        }
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          conversation_id?: unknown;
          turn?: { output_text?: unknown };
        };
        if (
          sessionId.current === activeSessionId
          && voiceRequestGeneration.current === requestGeneration
          && typeof payload.conversation_id === "string"
        ) {
          voiceConversationId.current = payload.conversation_id;
        }
        return typeof payload.turn?.output_text === "string" ? payload.turn.output_text.trim() || null : null;
      } catch {
        // The existing answer upload and browser speech fallback remain usable if
        // the optional gateway is unavailable.
        return null;
      }
    })();
    let timer: number | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), VOICE_CLIENT_TIMEOUT_MS);
    });
    try {
      // Do not abort the server request: if it finishes after the browser's
      // fallback timeout, the BFF can still bind the server-managed session for
      // the next turn.
      return await Promise.race([request, timeout]);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }

  async function finishAnswer() {
    if (finishing.current || !q) return;
    finishing.current = true;
    const [video, text] = await Promise.all([recorder.current.stop(), transcript.stop()]);
    setPhase("uploading");
    setProgress(0);
    if (q.index + 1 === state.total) await screen.stop();
    pendingVoiceReply.current = await requestVoiceReply(text, q.index);

    const form = new FormData();
    form.set("sessionId", sessionId.current ?? "");
    form.set("index", String(q.index));
    form.set("transcript", text);
    form.set("timeTakenSec", String(elapsed));
    if (video) form.set("video", video, `answer.${video.type.includes("mp4") ? "mp4" : "webm"}`);
    snapshots.current.forEach((s, i) => form.append("snapshots", s, `snap${i}.jpg`));
    await submit(form);
  }

  async function submit(form: FormData) {
    setPhase("uploading");
    setProgress(0);
    setError("");
    setPendingForm(null);
    try {
      const res = await uploadWithProgress(`${api}/answer`, form, setProgress);
      if (res.status === 409) return handleInterrupted();
      if (!res.ok) throw new Error(String(res.data.error || "Could not save your answer."));
      const next = res.data as unknown as InterviewState;
      const voiceReply = pendingVoiceReply.current;
      pendingVoiceReply.current = null;
      setState(next);
      if (next.nextQuestion) {
        const spokenQuestion = voiceReply ? `${voiceReply}\n\n${next.nextQuestion.text}` : next.nextQuestion.text;
        askQuestion(spokenQuestion);
      } else setPhase("done");
    } catch (err) {
      setPendingForm(form);
      setError(`${err instanceof Error ? err.message : err} Check your internet connection and try again.`);
    }
  }

  // ---------- Timers ----------
  // These re-run once per tick (phase/secondsLeft); the handlers they call read the latest
  // state from that render, so they're deliberately not dependencies.

  useEffect(() => {
    if (phase !== "prep") return;
    if (secondsLeft <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

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
      <EndCard icon="✓" tone="good" title="Thank you!">
        Your video interview has been submitted. Our hiring team will review it and contact you on your registered email
        or phone if you&apos;re shortlisted.
      </EndCard>
    );
  }

  if (phase === "interrupted") {
    return (
      <EndCard icon="!" tone="warn" title="Your interview was interrupted">
        <p>
          The interview was stopped before it finished, so it has been submitted as it is, with {state.answered} of{" "}
          {state.total} answers.
        </p>
        {state.interruptionReason && (
          <p className="mt-2 text-sm">
            Reason: {state.interruptionReason.replace(/^(The )?[Cc]andidate /, "you ").replace(/^you/, "You")}.
          </p>
        )}
        <p className="mt-3 font-semibold text-slate-800">
          To request a re-interview, please contact {state.hrContact}.
        </p>
      </EndCard>
    );
  }

  const mm = Math.floor(Math.max(0, secondsLeft) / 60);
  const ss = String(Math.max(0, secondsLeft) % 60).padStart(2, "0");

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {/*
        The device check is step 3 of 3, so it gets its own full-width layout
        rather than a column beside a preview. It is a screen in its own right
        and it is the last thing standing between someone and a recorded
        interview, which is the worst possible moment to make it feel like a
        sidebar.
      */}
      {phase === "setup" ? (
        <DeviceCheck
          state={state}
          browserOk={browserOk}
          camera={camera}
          videoEl={videoEl}
          proctorStatus={proctor.status}
          faceCount={proctor.faceCount}
          secondScreen={secondScreen}
          screenShared={Boolean(screen.stream)}
          screenError={screen.error}
          isFullscreen={proctor.isFullscreen}
          onShareScreen={screen.share}
          onFullscreen={async () => {
            setError("");
            if (!(await enterFullscreen())) {
              setError(
                "Your browser didn't allow fullscreen. Click \"Enter fullscreen\" again, and if a prompt appears, allow it. The interview can't start without fullscreen.",
              );
            }
          }}
          onStart={startInterview}
        />
      ) : (
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
          {live && proctor.warning && (
            <div className="absolute inset-x-3 top-12 rounded-md bg-red-600/95 px-3 py-2 text-sm font-semibold text-white shadow-lg">
              ⚠ {proctor.warning}
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
        </div>

        {/* Panel */}
        <Card className="flex flex-col">
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
                <p className="text-lg leading-relaxed font-semibold select-none">{q?.text}</p>
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
                    <p className="text-sm text-slate-600">{pendingForm ? "Upload failed." : "Saving your answer…"}</p>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress * 100}%` }} />
                    </div>
                    {pendingForm && (
                      <Button onClick={() => submit(pendingForm)} className="w-full">
                        Retry upload
                      </Button>
                    )}
                  </div>
                )}

                {guard.violations > 0 && (
                  <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    ⚠ {guard.violations} of {state.maxWarnings} warnings used.{" "}
                    {guard.violations >= state.maxWarnings
                      ? "Leaving this tab or fullscreen again will end your interview."
                      : "Stay on this tab, in fullscreen."}
                  </p>
                )}
                <p className="mt-4 text-xs text-slate-400">
                  Don&apos;t close or refresh this page. If the interview is interrupted, it will be submitted as it is.
                </p>
              </div>
            </>
        </Card>
        </div>
      )}

      {/* Fullscreen is required while the interview is live; recording continues behind this. */}
      {live && !screen.stream && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-900/95 p-6 text-center text-white">
          <p className="text-xl font-bold">Screen sharing stopped</p>
          <p className="max-w-md text-sm text-slate-300">
            Sharing your entire screen is required for this interview. Stopping it has been recorded. Your timer is still
            running.
          </p>
          {screen.error && <p className="max-w-md text-sm text-red-300">{screen.error}</p>}
          <Button
            onClick={async () => {
              setResharing(true);
              await screen.share();
              setResharing(false);
            }}
            className="px-6 py-2.5"
          >
            Share entire screen again
          </Button>
        </div>
      )}
      {live && guard.away && !resharing && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-red-950/95 p-6 text-center text-white">
          <p className="text-sm font-semibold tracking-wide text-red-200 uppercase">
            Warning {Math.min(guard.violations, state.maxWarnings)} of {state.maxWarnings}
          </p>
          <p className="text-2xl font-bold">
            {guard.away === "fullscreen" ? "You exited fullscreen" : "You left the interview"}
          </p>
          <p className="text-7xl font-bold tabular-nums">{guard.secondsLeft}</p>
          <p className="max-w-md text-sm text-red-100">
            Return {guard.away === "fullscreen" ? "to fullscreen" : "to this tab"} within {guard.secondsLeft} seconds or
            your interview will be submitted as it is.{" "}
            {guard.violations >= state.maxWarnings && "This is your last warning."}
          </p>
          {guard.away === "fullscreen" && (
            <Button onClick={() => enterFullscreen()} className="bg-white px-6 py-2.5 !text-red-700 hover:bg-red-50">
              Return to fullscreen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EndCard({
  icon,
  tone,
  title,
  children,
}: {
  icon: string;
  tone: "good" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="py-12 text-center">
      <div
        className={cn(
          "mx-auto mb-4 grid size-14 place-items-center rounded-full text-2xl font-bold",
          tone === "good" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600",
        )}
      >
        {icon}
      </div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mx-auto mt-2 max-w-lg text-slate-500">{children}</div>
      <p className="mt-4 text-sm text-slate-400">You can close this page now. Your camera has been turned off.</p>
    </Card>
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

function Check({ ok, pending, children }: { ok: boolean; pending?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn("font-bold", pending ? "text-slate-400" : ok ? "text-emerald-600" : "text-red-600")}>
        {pending ? "…" : ok ? "✓" : "✗"}
      </span>
      {children}
    </li>
  );
}

/**
 * Step 3 of 3: the device check.
 *
 * Replaces the old setup panel, which was a checklist in a sidebar next to the
 * camera preview. This is a screen, because that is what it is: the last thing
 * between a candidate and a recorded interview, and the moment where someone
 * finds out their laptop has no microphone or their browser will not hand over
 * the screen. Both are much better found here than two questions into a
 * recording.
 *
 * The gating itself is unchanged and still hard: `startInterview` re-checks the
 * screen stream and fullscreen itself, so nothing here is load-bearing for
 * correctness. This is about the candidate being able to see what is left.
 */
function DeviceCheck({
  state,
  browserOk,
  camera,
  videoEl,
  proctorStatus,
  faceCount,
  secondScreen,
  screenShared,
  screenError,
  isFullscreen,
  onShareScreen,
  onFullscreen,
  onStart,
}: {
  state: InterviewState;
  browserOk: boolean;
  camera: ReturnType<typeof useCamera>;
  videoEl: React.RefObject<HTMLVideoElement | null>;
  proctorStatus: "loading" | "ready" | "unavailable";
  faceCount: number | null;
  secondScreen: boolean;
  screenShared: boolean;
  screenError: string;
  isFullscreen: boolean;
  onShareScreen: () => void;
  onFullscreen: () => void;
  onStart: () => void;
}) {
  if (!browserOk) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <StepProgress steps={PRE_INTERVIEW_STEPS} current={3} />
        <h1 className="text-2xl font-bold">Please switch browser</h1>
        <p className="mt-2 text-slate-600">
          This interview needs <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on a laptop or
          desktop. Copy this page&apos;s link and open it there, and you&apos;ll come straight back to this step.
        </p>
        <div className="mt-6">
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(window.location.href)}>
            Copy interview link
          </Button>
        </div>
      </div>
    );
  }

  const cameraOn = Boolean(camera.stream);
  const faceOk = faceCount === 1;
  // Face checks are best-effort. If the models can't load, the interview still
  // runs and HR is told the checks were unavailable, rather than the candidate
  // being stuck at a spinner they cannot influence.
  const faceCleared = proctorStatus === "unavailable" || faceOk;
  const facePending = proctorStatus === "loading" || faceCount === null;

  // A fixed order, so the candidate always knows what is next: camera and mic,
  // then the whole screen, then fullscreen, then start.
  const step = !cameraOn ? 1 : !faceCleared ? 1 : !screenShared ? 2 : !isFullscreen ? 3 : 4;
  const action = !cameraOn
    ? { label: "Turn on camera & microphone", onClick: camera.enable, disabled: false }
    : step === 1
      ? { label: "Waiting for the face check…", onClick: () => {}, disabled: true }
      : step === 2
        ? { label: "Share your entire screen", onClick: onShareScreen, disabled: false }
        : step === 3
          ? { label: "Enter fullscreen", onClick: onFullscreen, disabled: false }
          : { label: "Start interview", onClick: onStart, disabled: false };

  return (
    <div className="mx-auto max-w-3xl">
      <StepProgress steps={PRE_INTERVIEW_STEPS} current={3} />

      <h1 className="text-2xl font-bold tracking-tight">
        Hi {state.fullName.split(" ")[0]}, let&apos;s check your setup
      </h1>
      <p className="mt-1 mb-6 text-slate-600">
        Three quick checks for the <strong className="text-slate-900">{state.jobTitle}</strong> interview, then you&apos;re
        straight in. Nothing here is recorded.
      </p>

      {/* Live preview. Kept large: it is the only way to tell whether the framing
          is right, and a thumbnail cannot show that. */}
      <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
        {camera.stream ? (
          <video ref={videoEl} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
        ) : (
          <div className="grid size-full place-items-center p-6 text-center">
            <div>
              <p className="text-sm font-medium text-slate-300">Your camera preview will appear here</p>
              <p className="mt-1 text-xs text-slate-500">Look straight at the camera, in good light</p>
            </div>
          </div>
        )}

        {camera.stream && (
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2.5 rounded-lg bg-black/60 px-3 py-2 text-xs text-white">
            <span aria-hidden="true">🎤</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${Math.max(3, camera.micLevel * 100)}%` }}
              />
            </div>
            <span className="shrink-0">{camera.micLevel > 0.02 ? "We can hear you" : "Say a few words to test your mic"}</span>
          </div>
        )}

        {/* The friendly loader the spec asks for, over the preview so it reads as
            "we're looking at you" rather than as an error. */}
        {camera.stream && facePending && (
          <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-center">
            <div>
              <Spinner className="mx-auto size-8 border-slate-600 border-t-white" />
              <p className="mt-3 text-sm font-medium text-white">Please wait — we&apos;re detecting your face…</p>
            </div>
          </div>
        )}
      </div>

      {/* Device pickers, only once there is more than one to pick. */}
      {cameraOn && (camera.cameras.length > 1 || camera.microphones.length > 1) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {camera.cameras.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Camera</span>
              <select
                value={camera.cameraId}
                onChange={(e) => camera.useDevice("camera", e.target.value)}
                className={cn(inputClass, "py-2")}
              >
                {camera.cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {camera.microphones.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Microphone</span>
              <select
                value={camera.micId}
                onChange={(e) => camera.useDevice("mic", e.target.value)}
                className={cn(inputClass, "py-2")}
              >
                {camera.microphones.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <Card className="mt-5">
        <ul className="space-y-2.5 text-sm">
          <Check ok={cameraOn} pending={!cameraOn}>
            Camera and microphone on
          </Check>
          {cameraOn &&
            (proctorStatus === "unavailable" ? (
              <Check ok={false}>Face check unavailable on this device — you can still continue</Check>
            ) : (
              <Check ok={faceOk} pending={facePending}>
                {facePending
                  ? "Looking for your face…"
                  : faceCount === 0
                    ? "No face found — sit facing the camera in better light"
                    : faceCount > 1
                      ? "More than one person found — you need to be alone for this"
                      : "Face found"}
              </Check>
            ))}
          <Check ok={screenShared} pending={!screenShared}>
            Entire screen shared
            {!screenShared && step === 2 && <span className="text-slate-500"> — choose &quot;Entire screen&quot;</span>}
          </Check>
          <Check ok={isFullscreen} pending={!isFullscreen}>
            Fullscreen on
          </Check>
          {secondScreen && <Check ok={false}>Second monitor detected — please disconnect it. This is recorded.</Check>}
        </ul>
      </Card>

      {(camera.error || screenError) && (
        <div className="mt-4">
          <Alert>{camera.error || screenError}</Alert>
        </div>
      )}

      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-slate-600">
        <li>
          {state.total} questions, each read aloud, then {state.prepSeconds}s to think and up to{" "}
          {state.minutesPerQuestion} min to answer on camera.
        </li>
        <li>
          Your camera, microphone and <strong>entire screen are recorded</strong>, and the interview runs in fullscreen.
        </li>
        <li>
          <strong>Stay on this tab, in fullscreen.</strong> You get {state.maxWarnings} warnings; leaving again, or
          staying away over {state.awayGraceSeconds}s, submits your interview.
        </li>
      </ul>

      <div className="mt-6 flex flex-col items-center gap-3">
        <Button onClick={action.onClick} disabled={action.disabled} className="w-full px-8 py-3 text-base sm:w-auto">
          {action.label}
        </Button>
        <p className="text-xs text-slate-400">
          Don&apos;t close or refresh once the interview starts. If it&apos;s interrupted, it&apos;s submitted as it is.
        </p>
      </div>
    </div>
  );
}
