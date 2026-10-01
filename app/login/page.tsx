import { after } from "next/server";
import { SiteFooter } from "@/components/careers/SiteFooter";
import { CandidateLogin } from "@/components/CandidateLogin";
import { runJobsIfDue } from "@/lib/jobs-runner";
import { IconVideo } from "@/components/icons";
import { PUBLIC_NAV, TopBar } from "@/components/ui";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOTICES: Record<string, string> = {
  login: "Please log in to continue your interview.",
};

/** Shortlisted applicants log in here with the details from their interview email. */
export const metadata = { title: `Interview login · ${config.companyName}` };

export default async function CandidateLoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  after(runJobsIfDue);
  const minutes = config.questionCount * (config.minutesPerQuestion + 1);
  const steps = [
    { title: "Check your setup", text: "Turn on your camera and microphone, share your screen and go fullscreen." },
    {
      title: `Answer ${config.questionCount} questions`,
      text: `Each question is read aloud. You get ${config.prepSeconds} seconds to think, then up to ${config.minutesPerQuestion} minutes to answer on camera.`,
    },
    { title: "That's it", text: "Your answers are submitted automatically. The hiring team will be in touch." },
  ];

  return (
    <>
      <TopBar company={config.companyName} step="Video interview" nav={PUBLIC_NAV} active="/login" />
      <main className="mx-auto grid max-w-5xl items-start gap-10 px-4 pt-10 pb-16 md:grid-cols-[1.1fr_1fr] md:pt-16">
        <section className="md:pt-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-soft-2 bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-fg">
            <span className="size-1.5 rounded-full bg-brand-500" /> AI video interview
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-fg sm:text-4xl">Welcome to your interview</h1>
          <p className="mt-3 max-w-md text-fg-3">
            A short, structured video interview you can take whenever suits you within your window. It takes about{" "}
            <strong className="text-fg-2">{minutes} minutes</strong>.
          </p>

          <ol className="mt-8 space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-sm font-bold text-brand-fg shadow-card ring-1 ring-line">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-fg">{s.title}</p>
                  <p className="text-sm text-fg-3">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex gap-3 rounded-xl border border-line bg-surface/70 p-4 text-sm text-fg-3">
            <IconVideo className="mt-0.5 size-5 shrink-0 text-brand-fg" />
            <p>Use a <strong className="text-fg-2">laptop or desktop</strong> with a webcam and microphone, ideally with Google
            Chrome or Microsoft Edge, in a quiet place.</p>
          </div>
        </section>

        <CandidateLogin notice={notice ? NOTICES[notice] : undefined} />
      </main>
      <SiteFooter hrContact={config.hrContact} />
    </>
  );
}
