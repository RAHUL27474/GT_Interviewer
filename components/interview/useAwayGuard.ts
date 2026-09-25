"use client";

// Enforces "stay on this tab, in fullscreen" while the interview is live:
//   - each time the candidate leaves counts as one violation (switching tab also exits fullscreen:
//     that is still one violation, which only ends once they are back in fullscreen);
//   - the first `maxWarnings` violations are warnings with a `graceSeconds` countdown;
//   - staying away past the countdown, or leaving once more after the warnings, ends the interview.
import { useEffect, useRef, useState } from "react";

export type AwayKind = "tab" | "fullscreen";

function currentAway(): AwayKind | null {
  if (document.hidden || !document.hasFocus()) return "tab";
  if (!document.fullscreenElement) return "fullscreen";
  return null;
}

const DESCRIBE: Record<AwayKind, string> = {
  tab: "left the interview tab/window",
  fullscreen: "exited fullscreen",
};

export function useAwayGuard(opts: {
  active: boolean;
  graceSeconds: number;
  maxWarnings: number;
  /** Suspend checks (e.g. while the screen-share picker is open). */
  paused: boolean;
  onTerminate: (reason: string) => void;
}) {
  const [away, setAway] = useState<AwayKind | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [violations, setViolations] = useState(0);

  const state = useRef({ away: null as AwayKind | null, since: 0, count: 0, done: false });
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!opts.active) {
      state.current.away = null;
      setAway(null);
      return;
    }
    const s = state.current;

    const terminate = (reason: string) => {
      if (s.done) return;
      s.done = true;
      latest.current.onTerminate(reason);
    };

    const check = () => {
      if (s.done || latest.current.paused) return;
      const { graceSeconds, maxWarnings } = latest.current;
      const now = Date.now();
      const kind = currentAway();

      if (kind && !s.away) {
        // A new violation starts.
        s.count += 1;
        setViolations(s.count);
        if (s.count > maxWarnings) {
          return terminate(`Candidate ${DESCRIBE[kind]} again after ${maxWarnings} warnings`);
        }
        s.since = now;
      } else if (!kind && s.away) {
        // Back in time.
        s.since = 0;
      }
      s.away = kind;
      setAway(kind);

      if (kind) {
        const left = Math.max(0, Math.ceil(graceSeconds - (now - s.since) / 1000));
        setSecondsLeft(left);
        if (left <= 0) terminate(`Candidate ${DESCRIBE[kind]} for more than ${graceSeconds} seconds`);
      }
    };

    // Events give an instant reaction; the interval keeps the countdown going and catches
    // focus changes that fire no event. Hidden tabs still run it about once a second.
    const events: [EventTarget, string][] = [
      [document, "visibilitychange"],
      [document, "fullscreenchange"],
      [window, "blur"],
      [window, "focus"],
    ];
    for (const [t, e] of events) t.addEventListener(e, check);
    const interval = setInterval(check, 500);
    check();
    return () => {
      for (const [t, e] of events) t.removeEventListener(e, check);
      clearInterval(interval);
    };
  }, [opts.active]);

  return { away, secondsLeft, violations };
}
