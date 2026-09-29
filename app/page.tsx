import { CandidateLogin } from "@/components/CandidateLogin";
import { TopBar } from "@/components/ui";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  login: "Please log in to continue your interview.",
};

/** Candidates log in here with the details from their interview email. Applications come in through Google Forms. */
export default async function CandidateLoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  return (
    <>
      <TopBar company={config.companyName} step="Video Interview" />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <CandidateLogin notice={notice ? NOTICES[notice] : undefined} />
        <p className="mx-auto mt-6 max-w-sm text-center text-sm text-slate-500">
          🎥 You&apos;ll need a <strong>laptop or desktop</strong> with a webcam and microphone, ideally with Google Chrome or
          Microsoft Edge. The interview takes about {config.questionCount * (config.minutesPerQuestion + 1)} minutes.
        </p>
      </main>
    </>
  );
}
