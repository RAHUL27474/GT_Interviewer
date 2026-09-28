import Link from "next/link";
import { BRIEF, INVITE, estimateInterviewMinutes, interviewTopics, inviteDeadline } from "@/lib/invite";
import { Bullet, Card, TopicPill } from "@/components/ui";
import type { Candidate } from "@/lib/types";

/**
 * Phase 2: the invitation, shown only to a shortlisted candidate.
 *
 * Deliberately server-rendered. There is nothing here to interact with except
 * the button, so shipping a client bundle to a page whose whole job is to be
 * read once and leave would be cost without benefit.
 *
 * Two things this screen must never do, and the copy in `lib/invite.ts` is where
 * that is enforced:
 *
 * - Show a score, a threshold, or anything that reads as a verdict. They
 *   cleared the bar; telling them the number invites an appeal about a number
 *   they were never shown and cannot influence.
 * - Promise an email that was not sent. The note appears only when the
 *   notification record says the interview-ready mail actually went out, so a
 *   missing mail provider does not leave the page lying to everyone.
 */
export function ShortlistInvite({
  candidate,
  company,
  careersRoleUrl,
  questionCount,
  minutesPerQuestion,
  deadline,
}: {
  candidate: Candidate;
  company: string;
  /** Link back to the public role page, so they can re-read the JD. */
  careersRoleUrl: string;
  questionCount: number;
  minutesPerQuestion: number;
  /** Pre-rendered so the server and client agree on the string. */
  deadline: string;
}) {
  const minutes = estimateInterviewMinutes(questionCount, minutesPerQuestion);
  const topics = interviewTopics(candidate.jobSnapshot, candidate.resumeScreening);

  const emailed = (candidate.notifications ?? []).some(
    (n) => n.event === "interview_ready" && n.ok,
  );

  const facts: [string, string][] = [
    ["Format", "AI interview, on camera"],
    ["Estimated duration", `Up to ${minutes} minutes`],
    ["Last date to complete", deadline],
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 pt-8 pb-16">
      <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
        <span className="text-2xl" aria-hidden="true">
          ✓
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        {INVITE.opening(company, candidate.jobTitle)}
      </h1>
      <p className="mt-3 text-slate-600">{INVITE.intro}</p>

      <p className="mt-4 text-sm text-slate-500">
        You can{" "}
        <a href={careersRoleUrl} className="font-medium text-brand-700 underline hover:text-brand-800">
          {INVITE.reviewLink.toLowerCase()}
        </a>{" "}
        at any point before you start.
      </p>

      <Card className="mt-8">
        <h2 className="text-base font-semibold">{INVITE.expectHeading}</h2>
        {/*
          Stacked on a phone, two columns from `sm` up. A fixed 160px label
          column is fine on a laptop and unusable on a 320px screen, where it
          leaves the value about 120px and every date wraps mid-word.
        */}
        <dl className="mt-3 divide-y divide-slate-100 text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
              <dt className="text-slate-500 sm:w-40 sm:shrink-0">{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-sm leading-relaxed text-slate-600">{INVITE.answerMode}</p>

        {topics.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-sm font-semibold">Focus areas</h3>
            <ul className="flex flex-wrap gap-2">
              {topics.map((t) => (
                <TopicPill key={t}>{t}</TopicPill>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card className="mt-5">
        <h2 className="text-base font-semibold">{INVITE.beforeHeading}</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {INVITE.before.map((item) => (
            <Bullet key={item}>{item}</Bullet>
          ))}
        </ul>
      </Card>

      <div className="mt-8 text-center">
        <Link
          href={`/interview/${encodeURIComponent(candidate.id)}/details`}
          className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 sm:w-auto sm:px-10"
        >
          {INVITE.cta}
        </Link>
        {emailed ? (
          <p className="mt-3 text-sm text-slate-500">{INVITE.emailedNote(candidate.email)}</p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            Keep this link — it&apos;s the way back in. {BRIEF.refreshWarning}
          </p>
        )}
      </div>
    </main>
  );
}
