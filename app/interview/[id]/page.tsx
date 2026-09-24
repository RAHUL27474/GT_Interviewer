import { notFound } from "next/navigation";
import { VideoInterview } from "@/components/interview/VideoInterview";
import { TopBar } from "@/components/ui";
import { interviewState } from "@/lib/candidates";
import { config } from "@/lib/config";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await store.getCandidate(id);
  if (!candidate) notFound();

  return (
    <>
      <TopBar company={config.companyName} step="Step 2 of 2 · Video Interview" wide />
      <main className="mx-auto max-w-7xl px-4 pt-6 pb-16">
        <VideoInterview id={id} initialState={interviewState(candidate)} />
      </main>
    </>
  );
}
