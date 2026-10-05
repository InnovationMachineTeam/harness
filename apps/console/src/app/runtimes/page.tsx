import { Dashboard } from "@/uikit/components/Dashboard";
import { cachedDashboardData } from "@/core/cache";
import { buildDashboardData } from "@/core/registry";
import { findRepoRoot } from "@/core/repo";
import { loadConsoleState } from "@/core/state";
import { ADAPTERS } from "@/runtimes";

export const dynamic = "force-dynamic";

export default async function RuntimesPage() {
  const repoRoot = findRepoRoot();
  const data = await cachedDashboardData(`${repoRoot}|7d`, async () => buildDashboardData({ repoRoot, adapters: ADAPTERS, state: await loadConsoleState(repoRoot) }));
  return <Dashboard initial={data} />;
}
