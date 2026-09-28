"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { Alert, Button, Card, CardTitle, Field, inputClass, Spinner, StepProgress } from "@/components/ui";
import { PRE_INTERVIEW_STEPS } from "@/lib/invite";

export interface Prefill {
  fullName: string;
  email: string;
  phone: string;
  totalExperience: string;
  currentLocation: string;
}

interface Props {
  candidateId: string;
  role: string;
  joiningOptions: { value: string; label: string }[];
  prefill: Prefill;
}

/**
 * Step 1 of 3: details.
 *
 * Name, email and phone are prefilled with what the candidate typed at apply
 * time, so nobody re-enters data we already have. Everything else is theirs to
 * state.
 *
 * Prefill is a default, never a lock. Every field stays editable, and the server
 * re-validates all of it regardless.
 */
export function DetailsStep({ candidateId, role, joiningOptions, prefill }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/interview/${encodeURIComponent(candidateId)}/profile`, {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save your details. Please try again.");
      router.push(`/interview/${candidateId}/brief`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5">
        <StepProgress steps={PRE_INTERVIEW_STEPS} current={1} />
        {error && <Alert>{error}</Alert>}

        <Card>
          <CardTitle>Please check your details</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-slate-500">
            We&apos;ve carried your contact details over from your application for the {role} role. Check them, and fill
            in the rest.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName">
              <input
                id="fullName"
                name="fullName"
                required
                autoComplete="name"
                defaultValue={prefill.fullName}
                className={inputClass}
              />
            </Field>
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={prefill.email}
                className={inputClass}
              />
            </Field>
            <Field label="Phone" htmlFor="phone" className="sm:col-span-2">
              <PhoneInput required defaultValue={prefill.phone} />
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
                defaultValue={prefill.totalExperience}
                className={inputClass}
              />
            </Field>
            <Field label="Current location" htmlFor="currentLocation" optional>
              <input
                id="currentLocation"
                name="currentLocation"
                defaultValue={prefill.currentLocation}
                className={inputClass}
              />
            </Field>
            <Field label="LinkedIn profile" htmlFor="linkedin" optional className="sm:col-span-2">
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
          <CardTitle>Salary and joining</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-slate-500">
            These two answers help us plan realistically. They&apos;re never shown to the hiring team as a number, and
            they don&apos;t affect whether you get the interview — you already have it.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current CTC (₹ lakhs per annum)" htmlFor="currentCTC" hint="Enter 0 if you are a fresher.">
              <input
                id="currentCTC"
                name="currentCTC"
                type="number"
                min={0}
                step={0.1}
                defaultValue={0}
                required
                className={inputClass}
              />
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

        <label className="flex items-start gap-3 text-sm text-slate-600">
          <input type="checkbox" required className="mt-0.5 size-4 accent-brand-600" />
          <span>
            I confirm these details are correct. I agree that my interview will be video and screen recorded, and that
            my answers will be assessed with the help of AI and reviewed by the hiring team.
          </span>
        </label>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">Next: what the interview covers, and how long it takes.</p>
          <Button type="submit" disabled={submitting} className="px-6 py-2.5">
            Continue
          </Button>
        </div>
      </form>

      {submitting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-50/95 p-4 text-center">
          <Spinner />
          <p className="font-semibold">Preparing your interview…</p>
          <p className="max-w-xs text-sm text-slate-500">
            We&apos;re writing questions from your resume and the role. This usually takes under a minute.
          </p>
        </div>
      )}
    </>
  );
}
