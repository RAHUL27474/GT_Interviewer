import { after } from "next/server";
import { JobList, type JobCardData } from "@/components/careers/JobList";
import { SiteFooter } from "@/components/careers/SiteFooter";
import { IconAward, IconBriefcase, IconCheck, IconMapPin, IconUsers, IconVideo } from "@/components/icons";
import { buttonClass, PUBLIC_NAV, TopBar } from "@/components/ui";
import { company } from "@/lib/company";
import { config } from "@/lib/config";
import { jobFacts, jobSummary } from "@/lib/job-text";
import { runJobsIfDue } from "@/lib/jobs-runner";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata = {
  title: `Careers at ${company.name}`,
  description: `${company.intro} See open roles, apply online and track your application.`,
};

const TEAM_ICONS = [IconUsers, IconAward, IconBriefcase, IconCheck];

/** The careers site: the company, every open role, and how hiring works. */
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

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(800px_320px_at_85%_-10%,var(--brand-soft-2),transparent_70%),radial-gradient(600px_300px_at_0%_110%,var(--brand-soft),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-14 sm:pt-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-soft-2 bg-surface/70 px-3 py-1 text-xs font-semibold text-brand-fg backdrop-blur">
            <span className="size-1.5 rounded-full bg-brand-500" /> {jobs.length ? `${jobs.length} open role${jobs.length === 1 ? "" : "s"}` : "Careers"} ·{" "}
            {company.group}
          </span>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-6xl">{company.tagline}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fg-3">{company.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#roles" className={buttonClass("primary", "px-5 py-2.5")}>
              View open roles
            </a>
            <a href="/track" className={buttonClass("ghost", "px-5 py-2.5")}>
              Track your application
            </a>
          </div>

          <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-card lg:grid-cols-4">
            {company.stats.map((s) => (
              <div key={s.label} className="bg-surface px-6 py-5">
                <dt className="text-sm text-fg-3">{s.label}</dt>
                <dd className="mt-1 text-3xl font-semibold tracking-tight text-fg">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4">
        {/* Open roles */}
        <section id="roles" className="scroll-mt-24 pt-16">
          <SectionHeading eyebrow="Open roles" title="Find your next role" text="Apply in a few minutes, then follow your application online." />
          <JobList jobs={jobs} />
        </section>

        {/* About */}
        <section className="grid gap-10 pt-24 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow={`About ${company.name}`} title="Driving Delhi forward, one Toyota at a time" />
            <div className="space-y-4 text-[15px] leading-relaxed text-fg-2">
              {company.about.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {company.values.map((v) => (
              <div key={v.title} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand-fg">
                  <IconCheck className="size-[18px]" />
                </span>
                <p className="mt-3 font-semibold text-fg">{v.title}</p>
                <p className="mt-1 text-sm text-fg-3">{v.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Teams */}
        <section className="pt-24">
          <SectionHeading eyebrow="Where you could work" title="Teams across the dealership" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {company.teams.map((t, i) => {
              const Icon = TEAM_ICONS[i % TEAM_ICONS.length];
              return (
                <div key={t.title} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                  <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-fg-2">
                    <Icon className="size-[18px]" />
                  </span>
                  <p className="mt-3 font-semibold text-fg">{t.title}</p>
                  <p className="mt-1 text-sm text-fg-3">{t.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Locations */}
        <section className="pt-24">
          <SectionHeading eyebrow="Locations" title="Across Delhi NCR" text={`${company.name} showrooms, service centres and body shop. Head office: ${company.headOffice}.`} />
          <div className="grid gap-4 lg:grid-cols-3">
            {(
              [
                ["Showrooms", company.locations.showrooms],
                ["Service centres", company.locations.serviceCentres],
                ["Body shop", company.locations.bodyShops],
              ] as const
            ).map(([title, places]) => (
              <div key={title} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                <p className="flex items-center gap-2 font-semibold text-fg">
                  <IconMapPin className="size-4 text-brand-fg" /> {title}
                  <span className="text-sm font-normal text-fg-4">· {places.length}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {places.map((p) => (
                    <span key={p} className="rounded-md bg-surface-3 px-2 py-0.5 text-sm text-fg-2">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-fg-3">
            Part of {company.group}: {company.groupBrands.join(" · ")}.
          </p>
        </section>

        {/* Hiring process */}
        <section className="pt-24">
          <SectionHeading eyebrow="How hiring works" title="Simple, quick and transparent" />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Apply online", "Choose a role, fill in a short form and upload your resume. You get an Application ID straight away."],
              ["Resume review", `We review every application and email you within about ${hours} hour${hours === 1 ? "" : "s"}.`],
              ["AI video interview", `If shortlisted, take a short video interview from your laptop whenever suits you within ${config.interviewAccessHours} hours.`],
              ["Hiring team review", "Our hiring team reviews your interview and contacts you about next steps."],
            ].map(([t, d], i) => (
              <li key={t} className="relative rounded-2xl border border-line bg-surface p-5 shadow-card">
                <span className="grid size-8 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <p className="mt-3 font-semibold text-fg">{t}</p>
                <p className="mt-1 text-sm text-fg-3">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Closing call to action */}
        <section className="pt-24">
          <div className="flex flex-col items-start gap-5 rounded-3xl border border-line bg-gradient-to-br from-brand-600 to-brand-700 p-8 text-white shadow-card sm:flex-row sm:items-center sm:p-10">
            <div className="flex-1">
              <p className="text-2xl font-semibold tracking-tight">Ready to join {company.name}?</p>
              <p className="mt-1 text-white/80">Take a look at the open roles and apply in minutes.</p>
            </div>
            <div className="flex gap-3">
              <a href="#roles" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-white/90">
                View open roles
              </a>
              <a href="/login" className="flex items-center gap-2 rounded-lg border border-white/40 px-5 py-2.5 text-sm font-semibold hover:bg-white/10">
                <IconVideo className="size-4" /> Interview login
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter hrContact={config.hrContact} />
    </>
  );
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mb-8 max-w-2xl">
      <p className="text-xs font-semibold tracking-wider text-brand-fg uppercase">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-fg">{title}</h2>
      {text && <p className="mt-2 text-fg-3">{text}</p>}
    </div>
  );
}
