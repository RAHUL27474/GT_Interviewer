import { Dashboard } from "@/components/admin/Dashboard";
import { LoginForm } from "@/components/admin/LoginForm";
import { Alert, TopBar } from "@/components/ui";
import { getCurrentUser, toPublic } from "@/lib/auth";
import { toSummary } from "@/lib/candidates";
import { AI_PROVIDER_LABEL, config } from "@/lib/config";
import { emailRoute } from "@/lib/email";
import { googleConfigured, googleConnection } from "@/lib/google";
import type { GoogleStatus } from "@/lib/types";
import { JOINING_OPTIONS } from "@/lib/scoring";
import { isManagerOrAbove, ROLE_LABEL } from "@/lib/roles";
import { store } from "@/lib/store";
import { visibleJobs, visibleTeam } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const metadata = { title: `${config.companyName} · HR Dashboard` };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; connected?: string; google_error?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;

  let body;
  if (!user) {
    body = <LoginForm />;
  } else {
    const canSeeTeam = isManagerOrAbove(user.role);
    const [candidates, jobs, users, connection, route] = await Promise.all([
      store.listCandidates(),
      store.listJobs(),
      canSeeTeam ? store.listUsers() : Promise.resolve([]),
      googleConnection().catch(() => null),
      emailRoute(),
    ]);
    const google: GoogleStatus = {
      configured: googleConfigured,
      connection,
      canConnect: canSeeTeam,
      emailRoute: route,
      message: params.connected
        ? { tone: "info", text: `Connected Google account ${params.connected}.` }
        : params.google_error
          ? { tone: "error", text: params.google_error }
          : null,
    };
    body = (
      <Dashboard
        initialTab={params.tab === "jobs" ? "jobs" : "candidates"}
        google={google}
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
