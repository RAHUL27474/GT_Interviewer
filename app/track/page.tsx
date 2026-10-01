import { TrackLookup } from "@/components/careers/TrackLookup";
import { PUBLIC_NAV, TopBar } from "@/components/ui";
import { config } from "@/lib/config";

export const metadata = { title: `Track your application · ${config.companyName}` };

export default function TrackPage() {
  return (
    <>
      <TopBar company={config.companyName} step="Careers" nav={PUBLIC_NAV} active="/track" />
      <main className="mx-auto max-w-6xl px-4 pt-16 pb-20">
        <TrackLookup />
      </main>
    </>
  );
}
