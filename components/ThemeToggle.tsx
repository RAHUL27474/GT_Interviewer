"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY as KEY } from "@/lib/theme";

const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type ThemeChoice = "light" | "dark" | "system";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
];

/** Light / Dark / System switch. The choice is remembered in this browser; System follows the device setting. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(read());
    // Enable colour transitions only after the first paint, so loading the page never animates.
    const t = setTimeout(() => document.documentElement.classList.add("theme-ready"), 100);
    return () => clearTimeout(t);
  }, []);

  // In System mode, follow the device when it switches between light and dark.
  useEffect(() => {
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  function select(next: ThemeChoice) {
    setChoice(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
    apply(next);
  }

  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          title={`${o.label} theme`}
          onClick={() => select(o.value)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition",
            "focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none",
            choice === o.value ? "bg-surface text-fg shadow-sm" : "text-fg-3 hover:text-fg",
          )}
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
