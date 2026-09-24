import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function TopBar({ company, step, wide }: { company: string; step: string; wide?: boolean }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className={cn("mx-auto flex items-center gap-3 px-4 py-3.5", wide ? "max-w-7xl" : "max-w-3xl")}>
        <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          {company.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-semibold">{company}</span>
        <span className="ml-auto text-sm text-slate-500">{step}</span>
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm", className)}>{children}</section>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-lg font-semibold">{children}</h2>;
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
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} {optional && <span className="font-normal text-slate-400">(optional)</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
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

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg px-4 py-3 text-sm",
        tone === "error" ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700",
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600", className)}
    />
  );
}
