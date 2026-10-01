import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/careers/SiteFooter";
import { IconCheck, IconClock, IconX } from "@/components/icons";
import { buttonClass, Card, cn, PUBLIC_NAV, TopBar } from "@/components/ui";
import { findByTrackToken } from "@/lib/applications";
import { config } from "@/lib/config";
import { trackerView, type StepState } from "@/lib/tracker";

export const dynamic = "force-dynamic";
// A private page: keep it out of search engines.
export const metadata = { title: `Your application · ${config.companyName}`, robots: { index: false, follow: false } };

const when = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: config.timeZone,
      })
    : "";

const DOT: Record<StepState, string> = {
  done: "bg-ok-soft text-ok-fg ring-ok-fg/20",
  current: "bg-brand-600 text-white ring-brand-500/30",
  upcoming: "bg-surface-3 text-fg-4 ring-line",
  failed: "bg-danger-soft text-danger-fg ring-danger-fg/20",
};

/** The applicant's private tracking page (link from their confirmation email). */
export default async function TrackerPage({ params }: { params: Promise<{ token: string }> }) {
  const c = await findByTrackToken((await params).token);
  if (!c) notFound();
  const v = trackerView(c);

  return (
    <>
      <TopBar company={config.companyName} step="Your application" nav={PUBLIC_NAV} />
      <main className="mx-auto max-w-3xl px-4 pt-10 pb-20">
        <Card>
          <p className="text-sm text-fg-3">Application for</p>
          <h1 className="text-2xl font-bold tracking-tight text-fg">{v.jobTitle}</h1>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-3">
            <span>
              Application ID <strong className="font-mono text-fg">{v.ref || "—"}</strong>
            </span>
            <span>Applied {when(v.appliedAt)}</span>
          </div>
          <div
            className={cn(
              "mt-5 rounded-xl px-4 py-3 text-sm font-medium",
              v.tone === "good" ? "bg-ok-soft text-ok-fg" : v.tone === "bad" ? "bg-danger-soft text-danger-fg" : "bg-brand-soft text-brand-fg",
            )}
          >
            {v.headline}
          </div>

          {v.interview && !v.interview.started && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
              <IconClock className="size-5 text-brand-fg" />
              <p className="min-w-0 flex-1 text-sm text-fg-2">
                {v.interview.startBy ? (
                  <>
                    Start your interview before <strong className="text-fg">{when(v.interview.startBy)}</strong>. Your login
                    details are in your email.
                  </>
                ) : (
                  "Your login details are in your email."
                )}
              </p>
              <a href="/login" className={buttonClass("primary")}>
                Go to interview login
              </a>
            </div>
          )}
        </Card>

        <Card className="mt-6">
          <h2 className="mb-6 text-xs font-semibold tracking-wider text-fg-3 uppercase">Progress</h2>
          <ol className="relative">
            {v.steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-4 pb-8 last:pb-0">
                {i < v.steps.length - 1 && (
                  <span
                    className={cn("absolute top-8 bottom-0 left-[15px] w-0.5", s.state === "done" ? "bg-ok-fg/30" : "bg-line")}
                    aria-hidden
                  />
                )}
                <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4", DOT[s.state])}>
                  {s.state === "done" ? (
                    <IconCheck className="size-4" />
                  ) : s.state === "failed" ? (
                    <IconX className="size-4" />
                  ) : s.state === "current" ? (
                    <span className="size-2.5 animate-pulse rounded-full bg-white" />
                  ) : (
                    <span className="size-2 rounded-full bg-current" />
                  )}
                </span>
                <div className="min-w-0 pt-1">
                  <p className={cn("font-medium", s.state === "upcoming" ? "text-fg-4" : "text-fg")}>{s.title}</p>
                  {s.at && <p className="text-xs text-fg-3">{when(s.at)}</p>}
                  {s.detail && <p className="mt-1 text-sm text-fg-3">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <p className="mt-6 text-center text-sm text-fg-3">
          Questions? Contact {config.hrContact}. Bookmark this page to check back any time.
        </p>
      </main>
      <SiteFooter hrContact={config.hrContact} />
    </>
  );
}
