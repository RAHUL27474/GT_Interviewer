import { notFound, redirect } from "next/navigation";
import { StartDeadline } from "@/components/interview/StartDeadline";
import { VideoInterview } from "@/components/interview/VideoInterview";
import { Card, TopBar } from "@/components/ui";
import { accessExpired, isCandidateSession } from "@/lib/access";
import { interviewState } from "@/lib/candidates";
import { config } from "@/lib/config";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await store.getCandidate(id);
  if (!candidate) notFound();
  if (!(await isCandidateSession(candidate))) redirect("/?notice=login");
  const state = interviewState(candidate);

  return (
    <>
      <TopBar company={config.companyName} step="Video Interview" wide />
      <main className="mx-auto max-w-7xl px-4 pt-6 pb-16">
        {accessExpired(candidate) ? (
          <Card className="mx-auto max-w-lg">
            <h1 className="text-xl font-bold">The time to start has ended</h1>
            <p className="mt-2 text-sm text-slate-600">
              This interview had to be started by {new Date(candidate.access!.expiresAt!).toLocaleString()}. If you&apos;d
              still like to take it, please contact {config.hrContact}.
            </p>
          </Card>
        ) : (
          <>
            {state.startBy && <StartDeadline startBy={state.startBy} />}
            <VideoInterview id={id} initialState={state} />
          </>
        )}
      </main>
    </>
  );
}
