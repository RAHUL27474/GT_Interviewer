import { notFound, redirect } from "next/navigation";
import { VideoInterview } from "@/components/interview/VideoInterview";
import { TopBar } from "@/components/ui";
import { interviewState } from "@/lib/candidates";
import { config } from "@/lib/config";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Step 3 of 3, and then the interview itself.
 *
 * The device check lives inside this page rather than on a route of its own, and
 * that is deliberate. Screen-share and camera streams do not survive a
 * navigation: a separate /setup page would mean asking for permissions twice
 * and dropping the screen share the instant the candidate pressed Continue.
 * Keeping the check in the same client component that records means the stream
 * the candidate just approved is the stream that gets used.
 *
 * The 3/3 progress indicator is inside that component, so it only appears while
 * the check is actually on screen and disappears once the interview starts.
 */
export default async function SecondRoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await store.getCandidate(id);
  if (!candidate) notFound();
  if (
    candidate.status === "awaiting_screening" ||
    candidate.status === "screening" ||
    candidate.status === "profile_pending"
  ) {
    redirect(`/interview/${id}`);
  }

  return (
    <>
      {/* No phase name in the bar: this route covers the device check *and* the
          interview itself, and only the client knows which one is on screen. */}
      <TopBar company={config.companyName} step="Step 3 of 3" wide />
      <main className="mx-auto max-w-7xl px-4 pt-6 pb-16">
        <VideoInterview id={id} initialState={interviewState(candidate)} />
      </main>
    </>
  );
}