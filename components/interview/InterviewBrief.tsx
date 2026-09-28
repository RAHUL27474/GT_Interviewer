import Link from "next/link";
import { Card, StepProgress, TopicPill } from "@/components/ui";
import { BRIEF, PRE_INTERVIEW_STEPS, estimateInterviewMinutes, interviewTopics } from "@/lib/invite";
import type { Candidate } from "@/lib/types";

/**
 * Step 2 of 3: the brief.
 *
 * Server-rendered, like the invitation, and for the same reason — there is one
 * link on it.
 *
 * This screen exists to do one job well: make the interview feel small. Someone
 * who has been told "up to 24 minutes, six questions, here's what they'll be
 * about, and here is exactly what gets recorded" arrives at the camera check
 * calm. The same information is already on the device-check screen, but buried in
 * a checklist next to two things that genuinely do need attention; here it gets
 * the whole page.
 */
export function InterviewBrief({
  candidate,
  company,
  roleUrl,
  questionCount,
  minutesPerQuestion,
}: {
  candidate: Candidate;
  company: string;
  roleUrl: string;
  questionCount: number;
  minutesPerQuestion: number;
}) {
  const minutes = estimateInterviewMinutes(questionCount, minutesPerQuestion);
  const topics = interviewTopics(candidate.jobSnapshot, candidate.resumeScreening);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-8 pb-16">
      <StepProgress steps={PRE_INTERVIEW_STEPS} current={2} />

      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{BRIEF.heading}</h1>
      <p className="mt-3 text-slate-600">
        Thanks — your details are saved. Here&apos;s the {candidate.jobTitle} interview with {company}.
      </p>

      <Card className="mt-6">
        <p className="text-sm leading-relaxed text-slate-700">{BRIEF.durationLead(minutes)}</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          You&apos;ll hear each question read aloud, then get a moment to think before recording starts on its own.
        </p>
      </Card>

      {topics.length > 0 && (
        <Card className="mt-5">
          <h2 className="text-base font-semibold">{BRIEF.topicsHeading}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {topics.map((t) => (
              <TopicPill key={t}>{t}</TopicPill>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-500">
            The exact questions are written from your resume, so they may follow you a little.{" "}
            <a href={roleUrl} className="font-medium text-brand-700 underline hover:text-brand-800">
              Re-read the role
            </a>{" "}
            if you want the detail.
          </p>
        </Card>
      )}

      <Card className="mt-5 border-amber-200 bg-amber-50/60">
        <h2 className="text-base font-semibold text-amber-900">Two things worth knowing</h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">{BRIEF.recording}</p>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">{BRIEF.refreshWarning}</p>
      </Card>

      <div className="mt-8 text-center">
        <Link
          href={`/interview/${encodeURIComponent(candidate.id)}/round-2`}
          className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 sm:w-auto sm:px-10"
        >
          {BRIEF.cta}
        </Link>
        <p className="mt-3 text-sm text-slate-500">Next: a quick check of your camera, microphone and screen.</p>
      </div>
    </main>
  );
}
