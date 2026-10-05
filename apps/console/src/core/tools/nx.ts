import { globalInstallCommand, type ToolDef } from "../tools";

/**
 * Плагин инструмента nx: оркестратор задач монорепозитория с локальным кешем.
 * Per-runtime интеграций нет - чистый CLI для проектов с nx.json; в этом
 * репозитории вызывается внутри verify.ts (кеш .nx/, AGENTS.md §7).
 */
export const nxTool: ToolDef = {
  id: "nx",
  title: "nx",
  description:
    "Оркестратор задач с локальным кешем .nx (test/build/validate): повторный прогон на неизменённом коде читается из кеша. Здесь работает внутри verify.ts (AGENTS.md §7); в других проектах - по nx.json.",
  docsUrl: "https://nx.dev",
  category: "code",
  bin: "nx",
  systemInstall: (pm) => globalInstallCommand(pm, "nx"),
  perRuntime: {
    supported: [],
    installCommand: () => [],
    uninstallCommand: () => [],
  },
};
