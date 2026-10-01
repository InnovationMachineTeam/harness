import path from "node:path";
import { globalInstallCommand, type ToolDef } from "../tools";
import { workspaceDirs } from "../state";
import type { ConsoleState } from "../state";
import type { ToolInstallParams } from "../state";

/** Плагин инструмента qmd: локальный гибридный поиск по markdown. */
export const qmdTool: ToolDef = {
  id: "qmd",
  title: "qmd",
  description:
    "Локальный гибридный поиск по markdown (BM25 + векторы + реранкинг): агент получает релевантные фрагменты доков вместо чтения файлов.",
  docsUrl: "https://github.com/tobi/qmd",
  category: "search",
  bin: "qmd",
  systemInstall: (pm) => globalInstallCommand(pm, "@tobilu/qmd"),
  mcpPreset: () => ({ type: "stdio", command: "qmd", args: ["mcp"] }),
  perRuntime: {
    supported: [],
    installCommand: () => [],
    uninstallCommand: () => [],
    params: [
      {
        key: "indexWorkspaces",
        label: "Проиндексировать рабочие папки (qmd collection add)",
        hint: "После установки добавит каждую рабочую папку в индекс qmd",
      },
    ],
  },
  postInstallCommands: (state: ConsoleState, params: ToolInstallParams) =>
    params.indexWorkspaces
      ? workspaceDirs(state).map((dir) => [
          "qmd",
          "collection",
          "add",
          dir,
          "--name",
          path.basename(dir).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32) || "workspace",
        ])
      : [],
};
