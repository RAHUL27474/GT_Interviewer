import { notFound } from "next/navigation";
import { ApplyForm } from "@/components/careers/ApplyForm";
import { IconMapPin } from "@/components/icons";
import { Card, PUBLIC_NAV, TopBar } from "@/components/ui";
import { config } from "@/lib/config";
import { jobFacts, jobSummary, parseDescription } from "@/lib/job-text";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

async function findJob(id: string) {
  return (await store.listJobs()).find((j) => j.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const job = await findJob((await params).id);
  return job
    ? { title: `${job.title} · Careers at ${config.companyName}`, description: jobSummary(job.description, 160) }
    : { title: `Careers · ${config.companyName}` };
}

/** One role: the full description and the application form. */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const job = await findJob((await params).id);
  if (!job) notFound();
  // Job type / experience / duration are shown as chips under the title, so they aren't repeated in the text.
  const FACT_HEADINGS = new Set(["job type", "experience", "duration"]);
  const blocks = parseDescription(job.description).filter((b, i, all) => {
    if (b.kind === "heading") return !FACT_HEADINGS.has(b.text.toLowerCase());
    const prev = all[i - 1];
    return !(b.kind === "paragraph" && prev?.kind === "heading" && FACT_HEADINGS.has(prev.text.toLowerCase()));
  });
  const facts = jobFacts(job.description);

  return (
    <>
      <TopBar company={config.companyName} step="Careers" nav={PUBLIC_NAV} />
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20">
        <a href="/" className="text-sm text-fg-3 hover:text-fg">
          ← All open roles
        </a>
        <div className="mt-4 grid items-start gap-8 lg:grid-cols-[1fr_420px]">
          <article>
            <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{job.title}</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.location && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2.5 py-1 text-sm text-fg-2">
                  <IconMapPin className="size-3.5" /> {job.location}
                </span>
              )}
              {facts.map((f) => (
                <span key={f} className="rounded-md bg-surface-3 px-2.5 py-1 text-sm text-fg-2">
                  {f}
                </span>
              ))}
            </div>

            <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-fg-2">
              {blocks.map((b, i) =>
                b.kind === "heading" ? (
                  <h2 key={i} className="pt-4 text-lg font-semibold tracking-tight text-fg">
                    {b.text}
                  </h2>
                ) : b.kind === "list" ? (
                  <ul key={i} className="space-y-1.5 pl-1">
                    {b.items.map((item, k) => (
                      <li key={k} className="flex gap-3">
                        <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={i}>{b.text}</p>
                ),
              )}
            </div>
          </article>

          <aside className="lg:sticky lg:top-24">
            <Card>
              {job.active ? (
                <ApplyForm
                  jobId={job.id}
                  jobTitle={job.title}
                  joiningOptions={JOINING_OPTIONS.map(({ value, label }) => ({ value, label }))}
                />
              ) : (
                <div className="text-center">
                  <h2 className="text-lg font-semibold">This role is closed</h2>
                  <p className="mt-1 text-sm text-fg-3">It&apos;s no longer taking applications.</p>
                  <a href="/" className="mt-4 inline-block text-sm font-medium text-brand-fg hover:underline">
                    See open roles
                  </a>
                </div>
              )}
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}
