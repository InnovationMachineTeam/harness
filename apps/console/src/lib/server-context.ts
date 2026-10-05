import { loadConsoleState, saveConsoleState, type ConsoleState } from "@/core/state";
import { findRepoRoot } from "@/core/repo";
import { migrateProviderEntries, ensureProviderBaseSettings } from "@/core/providerSettings";
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
  // записи провайдеров старого формата (все поля в state.json) переносятся
  // в .agents/providers/<id>/ один раз; в state остаются поля проверки
  if (await migrateProviderEntries(repoRoot, state)) {
    await saveConsoleState(repoRoot, state);
  }
  // базовые настройки всех пресетов существуют как файлы (значения карточек
  // подставляются из них); пользовательские файлы не перезаписываются
  await ensureProviderBaseSettings(repoRoot);
  return {
    repoRoot,
    state,
    adapters: ADAPTERS,
    async saveState() {
      await saveConsoleState(repoRoot, state);
    },
  };
}
