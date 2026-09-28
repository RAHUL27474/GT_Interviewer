import { ResumeScreenWaiting } from "@/components/interview/ResumeScreenWaiting";
import { ShortlistInvite } from "@/components/interview/ShortlistInvite";
import { TopBar } from "@/components/ui";
import { jobUrl } from "@/lib/careers";
import { config } from "@/lib/config";
import { inviteDeadline } from "@/lib/invite";
import { heldCandidateCopy } from "@/lib/screening-copy";
import { store } from "@/lib/store";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The candidate's way in, and the router for everything that follows.
 *
 * This one page decides which of four very different experiences someone has,
 * so each branch is a redirect rather than a conditional render. A candidate who
 * bookmarks a step, or comes back to a link in their email tomorrow, always
 * lands on the screen that matches the state of their application rather than on
 * a stale view of it.
 *
 *   screening / awaiting_screening  the quiet waiting page
 *   profile_pending                the invitation            (Phase 2)
 *   ready                          the brief, 2 of 3         (Phase 4)
 *   anything further               the device check + interview
 */
export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await store.getCandidate(id);
  if (!candidate) notFound();

  if (candidate.status === "awaiting_screening" || candidate.status === "screening") {
    // The status is passed explicitly rather than the whole record: the resolver
    // only accepts the two held states, so handing it `candidate` would not type
    // check even though the guard above proves the value.
    const copy = heldCandidateCopy({
      status: candidate.status,
      screeningError: candidate.screeningError,
      resumeScreening: candidate.resumeScreening,
    });
    return (
      <>
        <TopBar company={config.companyName} step="Application received" />
        <ResumeScreenWaiting status={candidate.status} hrContact={config.hrContact} copy={copy} />
      </>
    );
  }

  // Shortlisted, details not yet collected. This is the invitation.
  if (candidate.status === "profile_pending") {
    return (
      <>
        <TopBar company={config.companyName} step="Interview invitation" />
        <ShortlistInvite
          candidate={candidate}
          company={config.companyName}
          careersRoleUrl={jobUrl({ id: candidate.jobId })}
          questionCount={config.questionCount}
          minutesPerQuestion={config.minutesPerQuestion}
          deadline={inviteDeadline(new Date(), config.interviewInviteDeadlineHours)}
        />
      </>
    );
  }

  // Details are in and the questions exist, so the only thing left before the
  // interview is telling them what it involves.
  if (candidate.status === "ready") {
    redirect(`/interview/${id}/brief`);
  }

  redirect(`/interview/${id}/round-2`);
}
