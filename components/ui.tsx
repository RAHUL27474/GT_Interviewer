import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function TopBar({ company, step, wide }: { company: string; step: string; wide?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className={cn("mx-auto flex items-center gap-3 px-4 py-3", wide ? "max-w-7xl" : "max-w-5xl")}>
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">
          {company.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold">{company}</p>
          <p className="truncate text-xs text-fg-3">{step}</p>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface p-6 shadow-card", className)}>{children}</section>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-lg font-semibold tracking-tight">{children}</h2>;
}

export function Field({
  label,
  htmlFor,
  optional,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-fg-2">
        {label} {optional && <span className="font-normal text-fg-4">(optional)</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-fg-3">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg shadow-xs outline-none transition " +
  "placeholder:text-fg-4 hover:border-fg-4 focus:border-brand-500 focus:ring-3 focus:ring-brand-soft-2 " +
  "disabled:cursor-not-allowed disabled:bg-surface-2";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" };

/** Shared look for buttons and links styled as buttons. */
export function buttonClass(variant: NonNullable<ButtonProps["variant"]> = "primary", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition",
    "cursor-pointer select-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    "focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none",
    variant === "primary" && "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    variant === "secondary" && "border border-brand-600/70 bg-surface text-brand-fg hover:bg-brand-soft",
    variant === "ghost" && "border border-line-strong bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg",
    variant === "danger" && "bg-red-600 text-white shadow-sm hover:bg-red-700",
    className,
  );
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export type Tone = "good" | "warn" | "bad" | "neutral";

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone === "good" && "bg-ok-soft text-ok-fg",
        tone === "warn" && "bg-warn-soft text-warn-fg",
        tone === "bad" && "bg-danger-soft text-danger-fg",
        tone === "neutral" && "bg-brand-soft text-brand-fg",
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-xl border px-4 py-3 text-sm",
        tone === "error" ? "border-danger-line bg-danger-soft text-danger-fg" : "border-brand-soft-2 bg-brand-soft text-brand-fg",
      )}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-4 shrink-0" aria-hidden>
        {tone === "error" ? (
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        ) : (
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1 2a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0v-3a1 1 0 0 0-1-1Z"
            clipRule="evenodd"
          />
        )}
      </svg>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-10 animate-spin rounded-full border-4 border-brand-soft-2 border-t-brand-600", className)}
    />
  );
}
