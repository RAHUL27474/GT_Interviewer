import { RegistrationForm } from "@/components/RegistrationForm";
import { TopBar } from "@/components/ui";
import { config } from "@/lib/config";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { store } from "@/lib/store";
import type { PublicJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  // Salary budgets are internal, so only public fields reach the browser.
  const jobs: PublicJob[] = (await store.listJobs())
    .filter((j) => j.active)
    .map(({ id, title, location, description }) => ({ id, title, location, description }));

  return (
    <>
      <TopBar company={config.companyName} step="Step 1 of 2 · Registration" />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <h1 className="text-2xl font-bold tracking-tight">Apply for a position</h1>
        <p className="mt-1 mb-4 text-slate-500">
          Fill in your details and upload your resume. You&apos;ll then take a short video interview based on the role.
        </p>
        <div className="mb-6 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          🎥 For the video interview you&apos;ll need a <strong>laptop or desktop</strong> with a <strong>webcam and
          microphone</strong>, using <strong>Google Chrome or Microsoft Edge</strong>, in a quiet place. It takes about{" "}
          {config.questionCount * (config.minutesPerQuestion + 1)} minutes.
        </div>
        <RegistrationForm
          jobs={jobs}
          joiningOptions={JOINING_OPTIONS.map(({ value, label }) => ({ value, label }))}
          initialJobId={jobs.some((j) => j.id === job) ? job! : ""}
        />
      </main>
    </>
  );
}
