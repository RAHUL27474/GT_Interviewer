import { ApplicationForm } from "@/components/ApplicationForm";
import { TopBar } from "@/components/ui";
import { careersUrl } from "@/lib/careers";
import { config } from "@/lib/config";
import { store } from "@/lib/store";
import type { PublicJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const jobs: PublicJob[] = (await store.listJobs())
    .filter((j) => j.active)
    .map(({ id, title, location, description }) => ({ id, title, location, description }));

  return (
    <>
      <TopBar company={config.companyName} step="Apply" />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <h1 className="text-2xl font-bold tracking-tight">Apply for a position</h1>
        <p className="mt-1 mb-6 text-slate-500">
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
        <ApplicationForm jobs={jobs} initialJobId={jobs.some((j) => j.id === job) ? job! : ""} careersUrl={careersUrl()} />
      </main>
    </>
  );
}
