import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function TopBar({
  company,
  step,
  wide,
  action,
}: {
  company: string;
  step?: string;
  wide?: boolean;
  /** Right-hand slot: a link or button, e.g. a way back to the careers list. */
  action?: ReactNode;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className={cn("mx-auto flex items-center gap-3 px-4 py-3.5", wide ? "max-w-7xl" : "max-w-3xl")}>
        <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          {company.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-semibold">{company}</span>
        {step && !action && <span className="ml-auto text-sm text-slate-500">{step}</span>}
        {action && <div className="ml-auto flex items-center gap-3">{action}</div>}
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm", className)}>{children}</section>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-section mb-4 text-slate-800">{children}</h2>;
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
      {/* Micro, uppercase, tracked: a field name is a caption on the control, not
          a heading competing with it. */}
      <label htmlFor={htmlFor} className="text-micro mb-1.5 block text-slate-500 uppercase">
        {label} {optional && <span className="font-normal text-slate-400 normal-case">(optional)</span>}
      </label>
      {children}
      {hint && <p className="text-micro mt-1.5 text-slate-500 normal-case">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs outline-none transition " +
  "placeholder:text-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-100 disabled:bg-slate-50";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" };

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
        "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        variant === "secondary" && "border border-brand-600 bg-white text-brand-600 hover:bg-brand-50",
        variant === "ghost" && "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
    />
  );
}

export type Tone = "good" | "warn" | "bad" | "neutral";

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone === "good" && "bg-emerald-50 text-emerald-700",
        tone === "warn" && "bg-amber-50 text-amber-700",
        tone === "bad" && "bg-red-50 text-red-700",
        tone === "neutral" && "bg-brand-50 text-brand-700",
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  children,
  tone = "error",
  icon,
}: {
  children: ReactNode;
  tone?: "error" | "info" | "warn";
  /** Decorative glyph. Hidden from screen readers; the text carries the meaning. */
  icon?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg px-4 py-3 text-sm",
        tone === "error" && "bg-red-50 text-red-700",
        tone === "info" && "bg-brand-50 text-brand-700",
        // Amber, not red: a duplicate application is a neutral fact, not a fault.
        tone === "warn" && "bg-amber-50 text-amber-900",
      )}
    >
      {icon && (
        <span aria-hidden="true" className="mt-px shrink-0">
          {icon}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A muted metadata chip, e.g. "Full-time" or "0-2 years" beside a role title. */
export function MetaTag({ children }: { children: ReactNode }) {
  return (
    <span className="text-micro inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500 uppercase">
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600", className)}
    />
  );
}

/* ------------------------------------------------------- Pre-interview flow */

/**
 * The 1/3 · 2/3 · 3/3 indicator across the steps between a shortlist and the
 * interview starting.
 *
 * The labels are the point, not the numbers. A candidate three clicks from the
 * hardest part of the process is much better served by knowing the steps are
 * nearly done than by a percentage.
 */
export function StepProgress({ steps, current }: { steps: readonly { n: number; label: string }[]; current: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-slate-500">
          Step {current} of {steps.length}
        </span>
        <span className="text-brand-700">{steps.find((s) => s.n === current)?.label}</span>
      </div>
      <div className="mt-2 flex gap-1.5" aria-hidden="true">
        {steps.map((s) => (
          <span
            key={s.n}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              s.n < current ? "bg-brand-100" : s.n === current ? "bg-brand-600" : "bg-slate-200",
            )}
          />
        ))}
      </div>
      {/* Announced rather than shown, so a screen reader hears the same progress. */}
      <p className="sr-only" role="status">
        Step {current} of {steps.length}: {steps.find((s) => s.n === current)?.label}
      </p>
    </div>
  );
}

/** A focus area, as a pill. Used on the invitation and the brief. */
export function TopicPill({ children }: { children: ReactNode }) {
  return (
    <li className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm leading-snug font-medium text-brand-700">
      {children}
    </li>
  );
}

/** A tick-list item for the "before you begin" and device-check screens. */
export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

/* ------------------------------------------------- Hiring flow: stepper + rail */

export interface FlowStep {
  label: string;
  /** One line on what actually happens at this step. Sidebar only. */
  hint: string;
}

/** The three phases of the process, shared by the stepper and the rail. */
export const HIRING_STEPS: readonly FlowStep[] = [
  { label: "Resume screening", hint: "We read your resume against the role." },
  { label: "AI interview", hint: "A short interview you book yourself." },
  { label: "HR review", hint: "A person reads it and decides." },
];

type NodeState = "done" | "current" | "todo";

function nodeClasses(state: NodeState) {
  if (state === "done") return "bg-brand-600 text-white border-brand-600";
  if (state === "current") return "bg-brand-600 text-white border-brand-600 ring-4 ring-brand-100";
  return "bg-white text-slate-400 border-slate-300";
}

function stateOf(index: number, current: number): NodeState {
  if (index < current) return "done";
  if (index === current) return "current";
  return "todo";
}

/**
 * The horizontal numbered stepper under the nav bar.
 *
 * Numbers, not percentages: a candidate three clicks from a recorded interview
 * is better served by knowing which step they are on than by a bar.
 */
export function Stepper({ steps, current, wide }: { steps: readonly FlowStep[]; current: number; wide?: boolean }) {
  return (
    <nav aria-label="Hiring process">
      <ol className={cn("mx-auto flex items-start justify-between gap-2 px-4 py-6", wide ? "max-w-7xl" : "max-w-3xl")}>
        {steps.map((s, i) => {
          const state = stateOf(i + 1, current);
          return (
            <li key={s.label} className="flex flex-1 items-start gap-2.5 last:flex-none">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-4 h-0.5 w-6 shrink-0 rounded-full sm:w-10",
                    i < current ? "bg-brand-200" : "bg-slate-200",
                  )}
                />
              )}
              <span className="flex flex-col items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition",
                    nodeClasses(state),
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={cn(
                    "text-micro uppercase",
                    state === "todo" ? "text-slate-400" : "text-brand-700",
                  )}
                >
                  {s.label}
                </span>
                {/* Announced, not shown, so the current step is not colour-only. */}
                <span className="sr-only">
                  {state === "done" ? "Completed. " : state === "current" ? "Current step. " : "Not started. "}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The same three phases as a vertical rail, for the sidebar. */
export function ProgressTimeline({
  steps,
  current,
  className,
}: {
  steps: readonly FlowStep[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("space-y-5", className)}>
      {steps.map((s, i) => {
        const state = stateOf(i + 1, current);
        return (
          <li key={s.label} className="relative flex gap-3">
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-8 left-[15px] h-[calc(100%+0.25rem)] w-0.5 rounded-full",
                  i < current ? "bg-brand-200" : "bg-slate-200",
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition",
                nodeClasses(state),
              )}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="min-w-0 pt-1.5">
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={cn("text-body block font-bold", state === "todo" ? "text-slate-500" : "text-brand-700")}
              >
                {s.label}
                {state === "current" && <span className="sr-only"> (current step)</span>}
              </span>
              {/* Micro, and deliberately allowed to run to two lines: the rail's
                  job is to say what each phase involves, in one glance. */}
              <span className="text-micro mt-1 block text-slate-500 normal-case">{s.hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
