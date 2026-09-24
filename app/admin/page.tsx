import { Dashboard } from "@/components/admin/Dashboard";
import { LoginForm } from "@/components/admin/LoginForm";
import { Alert, TopBar } from "@/components/ui";
import { isAdmin } from "@/lib/auth";
import { toSummary } from "@/lib/candidates";
import { AI_PROVIDER_LABEL, config } from "@/lib/config";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: `${config.companyName} · HR Dashboard` };

export default async function AdminPage() {
  const signedIn = await isAdmin();

  let body;
  if (!config.adminPassword) {
    body = <Alert>Set ADMIN_PASSWORD in your .env file and restart the server to enable the dashboard.</Alert>;
  } else if (!signedIn) {
    body = <LoginForm />;
  } else {
    const [candidates, jobs] = await Promise.all([store.listCandidates(), store.listJobs()]);
    body = (
      <Dashboard
        candidates={candidates.map(toSummary)}
        jobs={jobs}
        joiningLabels={Object.fromEntries(JOINING_OPTIONS.map((o) => [o.value, o.label]))}
      />
    );
  }

  return (
    <>
      <TopBar company={config.companyName} step="HR Dashboard" wide />
      <main className="mx-auto max-w-7xl space-y-4 px-4 pt-6 pb-16">
        {signedIn && config.aiProvider !== "claude" && (
          <Alert tone="info">
            AI: <strong>{AI_PROVIDER_LABEL[config.aiProvider]}</strong>. Set ANTHROPIC_API_KEY in .env before launch to
            use Claude.
          </Alert>
        )}
        {body}
      </main>
    </>
  );
}
