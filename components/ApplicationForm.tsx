"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { jobTags } from "@/lib/jobs";
import type { PublicJob } from "@/lib/types";
import { PhoneInput } from "@/components/PhoneInput";
import { Alert, Button, Card, CardTitle, Field, MetaTag, inputClass, Spinner } from "./ui";
import { ResumeUploader } from "./ResumeUploader";

interface Props {
  jobs: PublicJob[];
  initialJobId: string;
  careersUrl: string;
}

/** An info glyph for the notice banners. Decorative; the text carries the meaning. */
function InfoGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a1 1 0 0 1 2 0v4a1 1 0 1 1-2 0V9Z"
        clipRule="evenodd"
      />
    </svg>
  );
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
 *
 * Ordering is deliberate: the role, then the resume, then contact details. The
 * first two are what the candidate came here to do. Asking for an email before
 * showing them the upload box reads like a lead form, which is what it is not.
 */
export function ApplicationForm({ jobs, initialJobId, careersUrl }: Props) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const [error, setError] = useState("");
  /** Latched once the server says this email is a second application. See onSubmit. */
  const [duplicate, setDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const job = jobs.find((j) => j.id === jobId);
  const tags = job ? jobTags(job) : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const body = new FormData(e.currentTarget);
    // The uploader hides the real input, so the browser cannot put a red bubble
    // on something the candidate cannot see. Check it here instead, with the
    // same wording the server uses.
    if (!(body.get("resume") instanceof File) || (body.get("resume") as File).size === 0) {
      setError("Please upload your resume.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/register", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 is this exact email on this role. It is a fact about the candidate,
        // not a transient failure, so it gets a persistent notice rather than a
        // red error that a retry appears to promise would fix.
        if (res.status === 409) {
          setDuplicate(true);
          setSubmitting(false);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        throw new Error(data.error || "Could not submit your resume. Please try again.");
      }
      router.push(`/interview/${data.id}`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (!jobs.length) {
    return (
      <Alert tone="info" icon={<InfoGlyph />}>
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
        {duplicate && (
          <Alert tone="warn" icon={<InfoGlyph />}>
            You have already applied for this position with this email. We&apos;ve found your previous application — you
            can keep going and submit again if something has changed, or{" "}
            <a href={careersUrl} className="font-medium underline">
              browse our other open roles
            </a>
            .
          </Alert>
        )}
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

          {job && tags && (
            // A second card, not more form. Someone who changes the dropdown
            // needs to be able to see what they just changed it to, without
            // scrolling back up to the select itself.
            <div className="mt-4 flex gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
                  <path d="m7.6 5.4-4 4.6a1 1 0 0 0 0 1.2l4 4.6a1 1 0 0 0 1.7-1l-3-3.4h6.4a1 1 0 1 0 0-2H6.3l3-3.4a1 1 0 0 0-1.7-1Zm4.8 0a1 1 0 0 0 0 1.4l3 3.4H9.6a1 1 0 1 0 0 2h5.8l-3 3.4a1 1 0 0 0 1.7 1l4-4.6a1 1 0 0 0 0-1.2l-4-4.6a1 1 0 0 0-1.7 1.2Z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{job.title}</p>
                {job.location && (
                  <p className="text-body mt-1 flex items-center gap-1.5 text-slate-600">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5 text-slate-400" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M10 2a5 5 0 0 0-5 5c0 3.6 4.2 9.5 4.4 9.8a.8.8 0 0 0 1.2 0c.2-.3 4.4-6.2 4.4-9.8a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {job.location}
                  </p>
                )}
                {(tags.employment || tags.experience) && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {tags.employment && <MetaTag>{tags.employment}</MetaTag>}
                    {tags.experience && <MetaTag>{tags.experience}</MetaTag>}
                  </div>
                )}
                <details className="text-body mt-3">
                  <summary className="w-fit cursor-pointer font-semibold text-brand-700 hover:text-brand-800">
                    View role description
                  </summary>
                  <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-4 whitespace-pre-wrap text-slate-700">
                    {job.description}
                  </div>
                </details>
              </div>
            </div>
          )}
        </Card>

        {!job && (
          // Holds the layout open on a direct visit so the card does not snap
          // when a role is chosen. Says what to do rather than filling in a role
          // the candidate may not want.
          <p className="text-body -mt-2 text-slate-600">Choose a position above to see its full description.</p>
        )}

        <Card>
          <CardTitle>Your resume</CardTitle>
          <ResumeUploader />
          <p className="text-body mt-4 text-slate-600">
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

        <label className="text-body flex items-start gap-3 text-slate-600">
          <input type="checkbox" required className="mt-0.5 size-4 accent-brand-600" />
          <span>
            I confirm my resume is mine to share, and I agree that it will be assessed with the help of AI and reviewed
            by the hiring team. If I&apos;m shortlisted, my interview will be video recorded.
          </span>
        </label>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body text-slate-600">
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
          <p className="text-body max-w-xs text-slate-600">
            We&apos;re reading your resume against the role. This usually takes under a minute.
          </p>
        </div>
      )}
    </>
  );
}
