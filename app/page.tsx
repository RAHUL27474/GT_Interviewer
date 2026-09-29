import { ApplicationForm } from "@/components/ApplicationForm";
import { Card, HIRING_STEPS, ProgressTimeline, Stepper, TopBar } from "@/components/ui";
import { careersUrl } from "@/lib/careers";
import { config } from "@/lib/config";
import { store } from "@/lib/store";
import type { PublicJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const jobs: PublicJob[] = (await store.listJobs())
    .filter((j) => j.active)
    .map(({ id, title, location, description, employmentType, experience }) => ({
      id,
      title,
      location,
      description,
      employmentType,
      experience,
    }));

  // A role named in the link wins. Failing that, preselect only when there is
  // exactly one open role, where there is no wrong answer. With several open
  // roles a direct visitor is left to choose: picking the first would fill in
  // the apply form for a job they may not want, and the cheapest mistake to fix
  // on a form is the one you never make.
  const initialJobId = jobs.some((j) => j.id === job) ? job! : jobs.length === 1 ? jobs[0].id : "";

  return (
    <>
      <TopBar
        company={config.companyName}
        wide
        action={
          <a
            href={careersUrl()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden="true">
              <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h2.2l1.5 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5V5.5Z" />
            </svg>
            Browse jobs
          </a>
        }
      />

      <Stepper steps={HIRING_STEPS} current={1} wide />

      <main className="mx-auto max-w-6xl px-4 pt-2 pb-16">
        {/* Main column carries the form, sidebar the state of the application.
            The rail is the second thing a candidate looks for, not the first, so
            it drops below the form on anything narrower than a laptop. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <h1 className="text-display text-slate-900">Apply for a position</h1>
            <p className="text-body mt-2 mb-7 text-slate-600">
              Upload your resume and we&apos;ll read it against the role. If it matches, you&apos;ll get a short AI
              interview you can book yourself, at a time that suits you.{" "}
              {/* /careers is the public, indexable source of truth for every role. A candidate
                  arriving from a search engine or a shared link should be able to find it from
                  here, so the apply page and the careers page are two doors to the same list. */}
              <a href={careersUrl()} className="font-medium text-brand-700 underline hover:text-brand-800">
                Browse all open roles
              </a>
              .
            </p>

            <ApplicationForm jobs={jobs} initialJobId={initialJobId} careersUrl={careersUrl()} />
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Card>
              <h2 className="text-section text-slate-800">Application progress</h2>
              {/* Tight under the title, because it describes it. The timeline is
                  content rather than caption, so it sits a step further down. */}
              <p className="text-micro mt-1 text-slate-500 normal-case">Your journey through the hiring process</p>
              <ProgressTimeline steps={HIRING_STEPS} current={1} className="mt-6" />
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}
