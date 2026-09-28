import { InterviewBrief } from "@/components/interview/InterviewBrief";
import { TopBar } from "@/components/ui";
import { jobUrl } from "@/lib/careers";
import { config } from "@/lib/config";
import { store } from "@/lib/store";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Step 2 of 3. Reachable only once the details are in and the questions exist,
 * so a candidate cannot sit on a brief for a role they were never shortlisted
 * for.
 */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await store.getCandidate(id);
  if (!candidate) notFound();
  if (candidate.status !== "ready") redirect(`/interview/${id}`);

  return (
    <>
      <TopBar company={config.companyName} step="Step 2 of 3 · What to expect" />
      <InterviewBrief
        candidate={candidate}
        company={config.companyName}
        roleUrl={jobUrl({ id: candidate.jobId })}
        questionCount={config.questionCount}
        minutesPerQuestion={config.minutesPerQuestion}
      />
    </>
  );
}
