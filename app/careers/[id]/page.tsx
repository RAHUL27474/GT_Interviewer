import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, TopBar } from "@/components/ui";
import {
  applyUrl,
  careersUrl,
  jobPostingJsonLd,
  jobUrl,
  organizationJsonLd,
  serializeJsonLd,
  toPublishedJob,
} from "@/lib/careers";
import { config } from "@/lib/config";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Only a listed role is public.
 *
 * An inactive job has to 404 rather than redirect to the index: it keeps
 * unlisted roles out of search indexes, and the careers page is the only place
 * to discover the ones that are open.
 */
async function findActiveJob(id: string) {
  const job = (await store.listJobs()).find((j) => j.id === id);
  return job?.active ? job : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const job = await findActiveJob(id);

  if (!job) return { title: "Role not found" };

  return {
    title: `${job.title} · Careers at ${config.companyName}`,
    description: `${job.title}${job.location ? ` in ${job.location}` : ""} at ${config.companyName}. ${job.description.replace(/\s+/g, " ").trim().slice(0, 150)}`,
    alternates: { canonical: `/careers/${encodeURIComponent(job.id)}` },
    openGraph: {
      title: `${job.title} · ${config.companyName}`,
      description: `${job.title}${job.location ? ` · ${job.location}` : ""}`,
      url: jobUrl(job),
      type: "article",
    },
  };
}

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const job = await findActiveJob(id);
  if (!job) notFound();

  const datePosted = job.postedAt && /^\d{4}-\d{2}-\d{2}$/.test(job.postedAt) ? job.postedAt : new Date().toISOString().slice(0, 10);
  // Derived through the same published view the feeds use, so the page, the
  // feeds and the JobPosting graph can never drift apart.
  const published = toPublishedJob(job);

  const graph = {
    "@context": "https://schema.org",
    "@graph": [organizationJsonLd(), jobPostingJsonLd(published, datePosted)],
  };

  return (
    <>
      <TopBar company={config.companyName} step="Careers" wide />
      <main className="mx-auto max-w-3xl px-4 pt-10 pb-20">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
        />

        <Link href="/careers" className="text-sm text-brand-700 hover:underline">
          &larr; All open roles
        </Link>

        <h1 className="mt-4 text-3xl font-bold tracking-tight">{job.title}</h1>
        <p className="mt-1 text-slate-500">
          {job.location ? `${job.location}, India` : "India"} · Full time · Posted {datePosted}
        </p>

        <Card className="mt-6">
          {/* descriptionHtml is produced by descriptionToHtml, which escapes the
              stored plain text before adding any tag, so the markup below is
              ours and not candidate-supplied. */}
          <div
            className="job-description [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-4 [&_ul]:mb-4"
            dangerouslySetInnerHTML={{ __html: published.descriptionHtml }}
          />
        </Card>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a href={applyUrl(job)}>
            <Button className="px-6 py-3 text-base">Apply for this role</Button>
          </a>
          <p className="text-sm text-slate-500">
            Two steps: register and upload your resume, then a short video interview.
          </p>
        </div>

        <p className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">
          {config.companyName} is an equal opportunity employer. We assess every application against the role&apos;s
          requirements and do not discriminate on gender, religion, caste, disability or sexual orientation. Questions
          about an application? Email {config.careersEmail}. This role is also published at{" "}
          <a href={careersUrl()} className="text-brand-700 hover:underline">
            {config.companyName} careers
          </a>
          .
        </p>
      </main>
    </>
  );
}
