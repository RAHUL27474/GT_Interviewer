import type { Metadata } from "next";
import Link from "next/link";
import { Card, Pill, TopBar } from "@/components/ui";
import {
  careersUrl,
  escapeHtml,
  itemListJsonLd,
  loadCareers,
  organizationJsonLd,
  serializeJsonLd,
} from "@/lib/careers";
import { config } from "@/lib/config";

// Jobs come from the store and change whenever HR edits one, so this must be
// rendered per request rather than baked at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Careers at ${config.companyName}`,
  description: `Open roles at ${config.companyName}. Browse current openings, check the team and the work, and apply online.`,
  alternates: {
    canonical: "/careers",
    types: {
      // Aggregators poll the feed; the JSON one carries the structured fields.
      "application/rss+xml": [{ url: "/careers/feed.xml", title: `${config.companyName} open roles` }],
      "application/feed+json": [{ url: "/careers/jobs.json", title: `${config.companyName} open roles` }],
    },
  },
  openGraph: {
    title: `Careers at ${config.companyName}`,
    description: `Open roles at ${config.companyName}.`,
    url: careersUrl(),
    type: "website",
  },
};

export default async function CareersPage() {
  const { jobs, dates } = await loadCareers();

  const graph = {
    "@context": "https://schema.org",
    "@graph": [organizationJsonLd(), itemListJsonLd(jobs)],
  };

  return (
    <>
      <TopBar company={config.companyName} step="Careers" wide />
      <main className="mx-auto max-w-3xl px-4 pt-10 pb-20">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
        />

        <h1 className="text-3xl font-bold tracking-tight">Open roles</h1>
        <p className="mt-2 mb-8 text-slate-500">
          {jobs.length === 0
            ? `We are not hiring right now. Check back soon, or email ${config.careersEmail}.`
            : `${jobs.length} open ${jobs.length === 1 ? "role" : "roles"}. Apply online and hear back within a week.`}
        </p>

        {jobs.length === 0 ? null : (
          <ul className="space-y-4">
            {jobs.map((job) => (
              <li key={job.id}>
                <Card className="transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {/* Wrapping the h2 keeps the heading itself a clean node
                            for the JobPosting list, rather than an anchor. */}
                        <Link href={`/careers/${encodeURIComponent(job.id)}`} className="hover:underline">
                          {escapeHtml(job.title)}
                        </Link>
                      </h2>
                      {job.location ? (
                        <p className="mt-1 text-sm text-slate-500">{escapeHtml(job.location)}, India</p>
                      ) : null}
                    </div>
                    <Pill tone="neutral">Full time</Pill>
                  </div>

                  <p className="mt-3 line-clamp-3 text-sm text-slate-600">{escapeHtml(job.summary)}</p>

                  <div className="mt-4 flex items-center gap-4 text-sm">
                    <Link
                      href={`/careers/${encodeURIComponent(job.id)}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      View role
                    </Link>
                    <span className="text-slate-400">Posted {dates.get(job.id)}</span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <h2 className="text-sm font-semibold text-slate-700">Job alerts</h2>
          <p className="mt-1">
            New roles are published to this page first, then syndicated. Subscribe to the feed and your reader
            picks up every opening:{" "}
            <a href="/careers/feed.xml" className="text-brand-700 hover:underline">
              RSS
            </a>{" "}
            or{" "}
            <a href="/careers/jobs.json" className="text-brand-700 hover:underline">
              JSON Feed
            </a>
            .
          </p>
        </section>
      </main>
    </>
  );
}
