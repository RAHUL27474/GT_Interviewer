"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { PublicJob } from "@/lib/types";
import { Alert, Button, Card, CardTitle, Field, inputClass, Spinner } from "./ui";

interface Props {
  jobs: PublicJob[];
  joiningOptions: { value: string; label: string }[];
  initialJobId: string;
}

export function RegistrationForm({ jobs, joiningOptions, initialJobId }: Props) {
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
      if (!res.ok) throw new Error(data.error || "Registration failed. Please try again.");
      router.push(`/interview/${data.id}`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (!jobs.length) {
    return <Alert tone="info">There are no open positions right now. Please check back later.</Alert>;
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}

        <Card>
          <CardTitle>Position</CardTitle>
          <Field label="Position applying for" htmlFor="jobId">
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
            <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-700">
              {job.description}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Your details</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName">
              <input id="fullName" name="fullName" required autoComplete="name" className={inputClass} />
            </Field>
            <Field label="Email" htmlFor="email">
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <input
                id="phone"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                placeholder="+91 98xxxxxxxx"
                className={inputClass}
              />
            </Field>
            <Field label="Current location" htmlFor="currentLocation" optional>
              <input id="currentLocation" name="currentLocation" className={inputClass} />
            </Field>
            <Field label="Total experience (years)" htmlFor="totalExperience">
              <input
                id="totalExperience"
                name="totalExperience"
                type="number"
                min={0}
                max={60}
                step={0.5}
                required
                className={inputClass}
              />
            </Field>
            <Field label="LinkedIn profile" htmlFor="linkedin" optional>
              <input
                id="linkedin"
                name="linkedin"
                type="url"
                placeholder="https://linkedin.com/in/…"
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle>Salary &amp; joining</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current CTC (₹ lakhs per annum)" htmlFor="currentCTC" hint="Enter 0 if you are a fresher.">
              <input id="currentCTC" name="currentCTC" type="number" min={0} step={0.1} required className={inputClass} />
            </Field>
            <Field label="Expected CTC (₹ lakhs per annum)" htmlFor="expectedCTC">
              <input
                id="expectedCTC"
                name="expectedCTC"
                type="number"
                min={0.1}
                step={0.1}
                required
                className={inputClass}
              />
            </Field>
            <Field label="When can you join?" htmlFor="joiningCategory" className="sm:col-span-2">
              <select id="joiningCategory" name="joiningCategory" required defaultValue="" className={inputClass}>
                <option value="">Select…</option>
                {joiningOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle>Resume</CardTitle>
          <Field label="Upload resume" htmlFor="resume" hint="PDF, DOCX or TXT · max 5 MB">
            <input
              id="resume"
              name="resume"
              type="file"
              accept=".pdf,.docx,.txt"
              required
              className="block w-full text-sm text-slate-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </Field>
          <label className="mt-5 flex items-start gap-3 text-sm text-slate-600">
            <input type="checkbox" required className="mt-0.5 size-4 accent-brand-600" />
            I confirm the details above are correct. I agree that my interview will be video recorded, and that my resume,
            recordings and answers will be assessed with the help of AI and reviewed by the hiring team.
          </label>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting} className="px-6 py-2.5">
            Continue to interview →
          </Button>
        </div>
      </form>

      {submitting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-50/95 p-4 text-center">
          <Spinner />
          <p className="font-semibold">Reading your resume and preparing your interview…</p>
          <p className="text-sm text-slate-500">This usually takes under a minute. Please don&apos;t close this page.</p>
        </div>
      )}
    </>
  );
}
