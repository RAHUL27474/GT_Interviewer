import { Dashboard } from "@/components/admin/Dashboard";
import { LoginForm } from "@/components/admin/LoginForm";
import { Alert, TopBar } from "@/components/ui";
import { getCurrentUser, toPublic } from "@/lib/auth";
import { toSummary } from "@/lib/candidates";
import { AI_PROVIDER_LABEL, config } from "@/lib/config";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { isManagerOrAbove, ROLE_LABEL } from "@/lib/roles";
import { store } from "@/lib/store";
import { visibleJobs, visibleTeam } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const metadata = { title: `${config.companyName} · HR Dashboard` };

export default async function AdminPage() {
  const user = await getCurrentUser();

  let body;
  if (!user) {
    body = <LoginForm />;
  } else {
    const canSeeTeam = isManagerOrAbove(user.role);
    const [candidates, jobs, users] = await Promise.all([
      store.listCandidates(),
      store.listJobs(),
      canSeeTeam ? store.listUsers() : Promise.resolve([]),
    ]);
    body = (
      <Dashboard
        me={toPublic(user)}
        candidates={candidates.map(toSummary)}
        jobs={await visibleJobs(user, jobs)}
        team={visibleTeam(user, users).map(toPublic)}
        deleteAfterDays={config.accountDeleteAfterDays}
        joiningLabels={Object.fromEntries(JOINING_OPTIONS.map((o) => [o.value, o.label]))}
      />
    );
  }

  return (
    <>
      <TopBar company={config.companyName} step={user ? `${ROLE_LABEL[user.role]} Dashboard` : "Staff Dashboard"} wide />
      <main className="mx-auto max-w-7xl space-y-4 px-4 pt-6 pb-16">
        {user && config.aiProvider !== "claude" && (
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
