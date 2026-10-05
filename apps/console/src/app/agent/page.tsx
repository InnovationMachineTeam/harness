import { Page } from "@/uikit";
import { AgentWorkspace } from "@/uikit/components/agent/AgentWorkspace";
import { cachedDashboardData } from "@/core/cache";
import { buildDashboardData } from "@/core/registry";
import { findRepoRoot } from "@/core/repo";
import { loadConsoleState } from "@/core/state";
import { ADAPTERS } from "@/runtimes";

export const dynamic = "force-dynamic";

/** Раздел "Агент": четыре вкладки - Агент, Workflow, Роли, Адаптеры. */
export default async function AgentPage() {
  const repoRoot = findRepoRoot();
  const data = await cachedDashboardData(`${repoRoot}|7d`, async () =>
    buildDashboardData({
      repoRoot,
      adapters: ADAPTERS,
      state: await loadConsoleState(repoRoot),
    }),
  );
  return (
    <Page
      title="Агент"
      description="Диалог с агентом, каталог workflow, роли и адаптеры методологий."
    >
      <AgentWorkspace runtimes={data.runtimes} />
    </Page>
  );
}
