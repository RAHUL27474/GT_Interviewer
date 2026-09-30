"use client";

import { useEffect, useState } from "react";

function left(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/**
 * "Start before …, 23 h 12 min left", counting down. Hidden for good once the candidate enters fullscreen, the last
 * step before starting, so it never shows during the interview. Never reloads the page: that would end an interview.
 */
export function StartDeadline({ startBy }: { startBy: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onFs = () => document.fullscreenElement && setFullscreen(true);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);
  if (fullscreen) return null;
  const ms = Date.parse(startBy) - now;
  if (ms <= 0) {
    return (
      <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-fg">
        The time to start this interview has ended. Please contact HR.
      </div>
    );
  }
  return (
    <div
      className={
        "mb-4 rounded-lg px-4 py-3 text-sm " + (ms < 3_600_000 ? "bg-warn-soft text-warn-fg" : "bg-brand-soft text-brand-fg")
      }
    >
      ⏳ Please start your interview before <strong>{new Date(startBy).toLocaleString()}</strong> ({left(ms)} left).
    </div>
  );
}
