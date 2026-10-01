import { after } from "next/server";
import { JobList, type JobCardData } from "@/components/careers/JobList";
import { PUBLIC_NAV, TopBar } from "@/components/ui";
import { config } from "@/lib/config";
import { jobFacts, jobSummary } from "@/lib/job-text";
import { runJobsIfDue } from "@/lib/jobs-runner";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata = {
  title: `Careers · ${config.companyName}`,
  description: `Open roles at ${config.companyName}. Apply online and track your application.`,
};

/** The careers site: every open role. */
export default async function CareersPage() {
  after(runJobsIfDue);
  // Only public fields leave the server (never the salary budget or screening rules).
  const jobs: JobCardData[] = (await store.listJobs())
    .filter((j) => j.active)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((j) => ({
      id: j.id,
      title: j.title,
      location: j.location,
      facts: jobFacts(j.description),
      summary: jobSummary(j.description),
      postedAt: j.createdAt,
    }));
  const hours = Math.max(1, Math.round(config.decisionDelayMinutes / 60));

  return (
    <>
      <TopBar company={config.companyName} step="Careers" nav={PUBLIC_NAV} active="/" />
      <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
        <section className="mb-10 max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-soft-2 bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-fg">
            <span className="size-1.5 rounded-full bg-brand-500" /> We&apos;re hiring
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-fg sm:text-5xl">Careers at {config.companyName}</h1>
          <p className="mt-4 text-lg text-fg-3">
            {jobs.length
              ? `${jobs.length} open role${jobs.length === 1 ? "" : "s"}. Apply in a few minutes, then follow your application online.`
              : "There are no open roles right now. Please check back soon."}
          </p>
        </section>

        <JobList jobs={jobs} />

        <section className="mt-16">
          <h2 className="mb-4 text-xs font-semibold tracking-wider text-fg-3 uppercase">How hiring works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Apply", "Fill in a short form and upload your resume. You get an Application ID straight away."],
              ["Hear back", `We review every application. You'll hear from us by email within about ${hours} hour${hours === 1 ? "" : "s"}.`],
              ["Video interview", "If you're shortlisted, take a short AI video interview whenever suits you within the time given."],
            ].map(([t, d], i) => (
              <div key={t} className="rounded-2xl border border-line bg-surface/70 p-5">
                <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand-fg">{i + 1}</span>
                <p className="mt-3 font-semibold text-fg">{t}</p>
                <p className="mt-1 text-sm text-fg-3">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-fg-3">
            Already applied?{" "}
            <a href="/track" className="font-medium text-brand-fg hover:underline">
              Track your application
            </a>
          </p>
        </section>
      </main>
    </>
  );
}
