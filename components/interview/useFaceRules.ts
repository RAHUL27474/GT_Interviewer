"use client";

// Camera rules while the interview is live:
//   Looking away (head turned away, sustained): the first `maxLookAwayWarnings` times are
//     warnings; the next time ends the interview.
//   Another person on camera: the first time starts a `secondPersonGraceSeconds` countdown and
//     ends the interview if they're still visible at 0; any later appearance ends it immediately.
//   A different person in the candidate's place (face recognition): same as another person, but the
//     countdown only stops when the original candidate's face is recognised again.
import { useEffect, useRef, useState } from "react";
import type { FaceRule } from "./useProctor";

const FLASH_MS = 6000;

/**
 * One warning with a countdown: the first episode starts it, and it ends the interview at 0 unless
 * `visible` clears first; any later episode ends the interview immediately.
 */
function useCountdownRule(opts: {
  active: boolean;
  episode: boolean;
  visible: boolean;
  graceSeconds: number;
  isDone: () => boolean;
  terminate: (reason: string) => void;
  reasons: { again: string; stayed: string };
}) {
  const { active, episode, visible, graceSeconds } = opts;
  const [warnings, setWarnings] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const count = useRef(0);
  const countdownStart = useRef<number | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!active || !episode || latest.current.isDone()) return;
    count.current += 1;
    setWarnings(count.current);
    if (count.current > 1) {
      latest.current.terminate(latest.current.reasons.again);
      return;
    }
    countdownStart.current = Date.now();
    setSecondsLeft(graceSeconds);
  }, [episode, active]);

  useEffect(() => {
    if (secondsLeft === null) return;
    const t = setInterval(() => {
      if (countdownStart.current === null || latest.current.isDone()) {
        countdownStart.current = null;
        setSecondsLeft(null);
        return;
      }
      if (!visibleRef.current) {
        countdownStart.current = null;
        setSecondsLeft(null);
        return;
      }
      const left = Math.max(0, Math.ceil(graceSeconds - (Date.now() - countdownStart.current) / 1000));
      setSecondsLeft(left);
      if (left <= 0) latest.current.terminate(latest.current.reasons.stayed);
    }, 250);
    return () => clearInterval(t);
  }, [secondsLeft === null, graceSeconds]);

  return { warnings, secondsLeft };
}

export function useFaceRules(opts: {
  active: boolean;
  episodes: Record<FaceRule, boolean>;
  /** Whether anyone else is visible right now, so the countdown stops the moment they leave. */
  othersVisible: boolean;
  /** Whether the face on camera is someone other than the candidate right now. */
  strangerVisible: boolean;
  maxLookAwayWarnings: number;
  secondPersonGraceSeconds: number;
  onTerminate: (reason: string) => void;
}) {
  const { active, episodes, maxLookAwayWarnings, secondPersonGraceSeconds } = opts;
  const [lookAways, setLookAways] = useState(0);
  const [lookWarning, setLookWarning] = useState(false);

  const done = useRef(false);
  const lookCount = useRef(0);
  const terminateRef = useRef(opts.onTerminate);
  terminateRef.current = opts.onTerminate;
  const terminate = (reason: string) => {
    if (done.current) return;
    done.current = true;
    terminateRef.current(reason);
  };
  const isDone = () => done.current;

  // Looking away: count each new episode.
  useEffect(() => {
    if (!active || !episodes.looking_away || done.current) return;
    lookCount.current += 1;
    setLookAways(lookCount.current);
    if (lookCount.current > maxLookAwayWarnings) {
      terminate(`Candidate looked away from the screen again after ${maxLookAwayWarnings} warnings`);
      return;
    }
    setLookWarning(true);
    const t = setTimeout(() => setLookWarning(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [episodes.looking_away, active]);

  const person = useCountdownRule({
    active,
    episode: episodes.multiple_faces,
    visible: opts.othersVisible,
    graceSeconds: secondPersonGraceSeconds,
    isDone,
    terminate,
    reasons: {
      again: "Another person appeared on camera again after a warning",
      stayed: `Another person stayed on camera for more than ${secondPersonGraceSeconds} seconds`,
    },
  });

  const swap = useCountdownRule({
    active,
    episode: episodes.different_person,
    visible: opts.strangerVisible,
    graceSeconds: secondPersonGraceSeconds,
    isDone,
    terminate,
    reasons: {
      again: "A different person took the candidate's place on camera again after a warning",
      stayed: `A different person stayed in the candidate's place for more than ${secondPersonGraceSeconds} seconds`,
    },
  });

  return {
    lookAways,
    lookWarning,
    personWarnings: person.warnings,
    personSecondsLeft: person.secondsLeft,
    swapWarnings: swap.warnings,
    swapSecondsLeft: swap.secondsLeft,
  };
}
