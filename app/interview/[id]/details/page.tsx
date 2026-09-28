import { DetailsStep, type Prefill } from "@/components/interview/DetailsStep";
import { TopBar } from "@/components/ui";
import { config } from "@/lib/config";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { store } from "@/lib/store";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Step 1 of 3: details, for a shortlisted candidate.
 *
 * The prefill is assembled here rather than in the client component so that the
 * values come from one place, and so a value that Round 1 never found in the
 * resume is simply left blank rather than rendered as "null".
 */
export default async function DetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await store.getCandidate(id);
  if (!candidate) notFound();

  // Only a shortlisted candidate is asked for these. Everyone else is sent back
  // to the page that knows what is actually happening to their application.
  if (candidate.status !== "profile_pending") redirect(`/interview/${id}`);

  // What Round 1 already knows, which is contact details and nothing else.
  //
  // The candidate typed these at apply time, so echoing them back needs no
  // confidence estimate at all. The screening report's `candidateProfile` is
  // only a fallback for a record that predates the light apply form.
  //
  // Years of experience is deliberately NOT prefilled, even though the resume
  // report carries a number for it. On a live check the extractor read a
  // 2020-2025 resume as "2 years", and that value is scored: a wrong default
  // that looks like a real answer is worse than an empty box, because a
  // candidate skims a prefilled field and a wrong number is worth up to 20
  // points of their own score. They type their own number.
  const parsed = candidate.resumeScreening?.candidateProfile;
  const prefill: Prefill = {
    fullName: candidate.fullName || parsed?.name || "",
    email: candidate.email || parsed?.email || "",
    phone: candidate.phone || parsed?.phone || "",
    totalExperience: "",
    currentLocation: "",
  };

  return (
    <>
      <TopBar company={config.companyName} step="Step 1 of 3 · Your details" />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <DetailsStep
          candidateId={candidate.id}
          role={candidate.jobTitle}
          joiningOptions={JOINING_OPTIONS.map(({ value, label }) => ({ value, label }))}
          prefill={prefill}
        />
      </main>
    </>
  );
}
