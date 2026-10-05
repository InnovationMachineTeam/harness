import { notFound } from "next/navigation";
import { RuntimeSpace } from "@/uikit/components/RuntimeSpace";
import { probeGuardActivity, probeRuntimes } from "@/core/registry";
import { findRepoRoot } from "@/core/repo";
import { loadConsoleState } from "@/core/state";
import { ADAPTERS } from "@/runtimes";

export const dynamic = "force-dynamic";

export default async function RuntimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repoRoot = findRepoRoot();
  const state = await loadConsoleState(repoRoot);
  // проб только этого рантайма - страница space не пересчитывает остальные пять
  const [snapshots, guardActivity] = await Promise.all([
    probeRuntimes({ repoRoot, adapters: ADAPTERS, state, only: [id] }),
    probeGuardActivity(repoRoot),
  ]);
  const snapshot = snapshots[0];
  if (!snapshot) notFound();
  return (
    <RuntimeSpace
      snapshot={snapshot}
      repoRoot={repoRoot}
      isDefault={state.defaultRuntime === id}
      guardActivity={guardActivity}
    />
  );
}
