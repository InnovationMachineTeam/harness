import { loadConsoleState, type ConsoleState } from "@/core/state";
import { findRepoRoot } from "@/core/repo";
import type { RuntimeAdapter } from "@/core/types";
import { ADAPTERS } from "@/runtimes";

/** Общий контекст для API-роутов: корень репо + состояние + адаптеры. */
export interface ServerContext {
  repoRoot: string;
  state: ConsoleState;
  adapters: Record<string, RuntimeAdapter>;
  /** Перезаписать состояние (после мутаций). */
  saveState(): Promise<void>;
}

export async function serverContext(): Promise<ServerContext> {
  const repoRoot = findRepoRoot();
  const state = await loadConsoleState(repoRoot);
  return {
    repoRoot,
    state,
    adapters: ADAPTERS,
    async saveState() {
      const { saveConsoleState } = await import("@/core/state");
      await saveConsoleState(repoRoot, state);
    },
  };
}
