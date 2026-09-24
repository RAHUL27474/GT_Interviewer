"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing for the Web Speech API (not in TypeScript's DOM lib).
interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognizerCtor = new () => Recognizer;

function getCtor(): RecognizerCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Live speech-to-text while the candidate answers (Chrome / Edge). */
export function useTranscript(onBlocked: () => void) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [liveText, setLiveText] = useState("");
  const finalText = useRef("");
  const interimText = useRef("");
  const active = useRef(false);
  const recognizer = useRef<Recognizer | null>(null);
  const onEnded = useRef<(() => void) | null>(null);
  const blocked = useRef(onBlocked);
  blocked.current = onBlocked;

  useEffect(() => setSupported(Boolean(getCtor())), []);
  useEffect(() => () => {
    active.current = false;
    recognizer.current?.stop();
  }, []);

  function start() {
    const Ctor = getCtor();
    if (!Ctor) return;
    finalText.current = "";
    interimText.current = "";
    setLiveText("");
    active.current = true;

    const r = new Ctor();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) finalText.current = `${finalText.current} ${text}`.trim();
        else interim += ` ${text}`;
      }
      interimText.current = interim.trim();
      setLiveText(`${finalText.current} ${interimText.current}`.trim());
    };
    // Recognition stops on its own after silence; restart it until the answer is finished.
    r.onend = () => {
      if (active.current) {
        try {
          r.start();
        } catch {}
      } else {
        onEnded.current?.();
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        active.current = false;
        blocked.current();
      }
    };
    recognizer.current = r;
    r.start();
  }

  /** Stops listening and resolves with the full transcript once the last words are processed. */
  function stop(): Promise<string> {
    active.current = false;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onEnded.current = null;
        // Keep any words still pending when recognition was cut off.
        resolve(`${finalText.current} ${interimText.current}`.trim());
      };
      onEnded.current = finish;
      recognizer.current?.stop();
      setTimeout(finish, 1500);
    });
  }

  return { supported, liveText, start, stop };
}
