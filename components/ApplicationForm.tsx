"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { PublicJob } from "@/lib/types";
import { PhoneInput } from "@/components/PhoneInput";
import { Alert, Button, Card, CardTitle, Field, inputClass, Spinner } from "./ui";

interface Props {
  jobs: PublicJob[];
  initialJobId: string;
  careersUrl: string;
}

/**
 * Step 0: the apply form.
 *
 * Short on purpose. This page is the whole of Round 1's first impression, and
 * every field here is one a candidate has to stop and think about. Salary and
 * joining date used to sit on this form; they now wait until after the shortlist,
 * so someone who is not going to be interviewed never has to disclose them.
 *
 * The one thing that is still mandatory is the resume, because it is what Round
 * 1 actually runs on.
 */
export function ApplicationForm({ jobs, initialJobId, careersUrl }: Props) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const job = jobs.find((j) => j.id === jobId);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/register", { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit your resume. Please try again.");
      router.push(`/interview/${data.id}`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (!jobs.length) {
    return (
      <Alert tone="info">
        There are no open positions right now. Please check back later, or browse{" "}
        <a href={careersUrl} className="font-medium underline">
          all our roles
        </a>
        .
      </Alert>
    );
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}

        <Card>
          <CardTitle>What are you applying for?</CardTitle>
          <Field label="Position" htmlFor="jobId">
            <select
              id="jobId"
              name="jobId"
              required
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a position…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                  {j.location ? ` · ${j.location}` : ""}
                </option>
              ))}
            </select>
          </Field>
          {job && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-brand-700">Read the full role description</summary>
              <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 whitespace-pre-wrap text-slate-700">
                {job.description}
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle>Your resume</CardTitle>
          <Field label="Upload your resume" htmlFor="resume" hint="PDF, DOCX or TXT · max 5 MB">
            <input
              id="resume"
              name="resume"
              type="file"
              accept=".pdf,.docx,.txt"
              required
              className="block w-full text-sm text-slate-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </Field>
          <p className="mt-3 text-sm text-slate-500">
            We read this first. If your experience matches the role, you&apos;ll get a short AI interview to book
            yourself — there&apos;s nothing else to fill in unless you do.
          </p>
        </Card>

        <Card>
          <CardTitle>How do we reach you?</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName">
              <input id="fullName" name="fullName" required autoComplete="name" className={inputClass} />
            </Field>
            <Field label="Email" htmlFor="email">
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </Field>
            <Field label="Phone" htmlFor="phone" className="sm:col-span-2">
              <PhoneInput required />
            </Field>
          </div>
        </Card>

        <label className="flex items-start gap-3 text-sm text-slate-600">
          <input type="checkbox" required className="mt-0.5 size-4 accent-brand-600" />
          <span>
            I confirm my resume is mine to share, and I agree that it will be assessed with the help of AI and reviewed
            by the hiring team. If I&apos;m shortlisted, my interview will be video recorded.
          </span>
        </label>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Takes about a minute. If you&apos;re shortlisted, you&apos;ll get a link to book your interview.
          </p>
          <Button type="submit" disabled={submitting} className="px-6 py-2.5">
            Submit application
          </Button>
        </div>
      </form>

      {submitting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-50/95 p-4 text-center">
          <Spinner />
          <p className="font-semibold">Submitting your application…</p>
          <p className="max-w-xs text-sm text-slate-500">
            We&apos;re reading your resume against the role. This usually takes under a minute.
          </p>
        </div>
      )}
    </>
  );
}
