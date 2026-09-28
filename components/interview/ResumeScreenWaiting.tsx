"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Pill, Spinner } from "@/components/ui";
import type { OutcomeCopy } from "@/lib/screening-copy";
import type { CandidateStatus } from "@/lib/types";

/**
 * What the candidate is told once Round 1 screening has finished.
 *
 * The wording, and the reasoning behind what it withholds, lives in
 * lib/screening-copy.ts so it can be asserted on directly.
 *
 * The resolved copy arrives as a prop rather than as a status to look up. Both
 * held states map to the same message, so the component has no use for which one
 * it was — and passing the label instead would put "NOT_SHORTLISTED" into the
 * RSC flight payload embedded in the page source. Nothing on screen said it, but
 * a candidate who reads the HTML would learn that an automated system decided
 * they were not good enough, which is the exact thing the copy is built to avoid
 * and the thing HR has to unpick. The label belongs on /admin and nowhere else.
 */
export function ResumeScreenWaiting({
  status,
  hrContact,
  copy,
}: {
  status: CandidateStatus;
  hrContact: string;
  /** Resolved server-side. Null while screening is still running. */
  copy: OutcomeCopy | null;
}) {
  const router = useRouter();
  // Only poll while the AI is still working. A finished outcome is terminal, so stop refreshing.
  const preparing = status === "screening";

  useEffect(() => {
    if (!preparing) return;
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [router, preparing]);

  const finished = !preparing && copy !== null;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 pb-16">
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <Pill tone={copy?.tone ?? "neutral"}>
            {preparing ? "AI screening in progress" : (copy?.pill ?? "Awaiting HR review")}
          </Pill>
          {preparing && <Spinner />}
        </div>
        <h1 className="text-2xl font-bold text-balance">{copy?.heading}</h1>
        <p className="mt-2 text-slate-600">{copy?.body}</p>
        {finished && (
          <p className="mt-4 text-sm text-slate-500">
            If you are contacted, it will come from {hrContact}. Please quote the position you applied for.
          </p>
        )}
        {preparing && (
          <p className="mt-4 text-sm text-slate-500">
            Keep this page open. It will update automatically when your interview is ready.
          </p>
        )}
      </Card>
    </main>
  );
}
