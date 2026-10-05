import { globalInstallCommand, type ToolDef } from "../tools";

/**
 * Плагин инструмента CodeBurn: анализ расхода AI-токенов и стоимости по
 * задачам, инструментам, моделям и проектам (локальные данные сессий
 * рантаймов). Per-runtime интеграций нет - чистый CLI; требуется для отчёта
 * CodeBurn во вкладке "Оптимизация" (null-state без установленного CLI).
 */
export const codeburnTool: ToolDef = {
  id: "codeburn",
  title: "CodeBurn",
  description:
    "Анализ расхода AI-токенов и стоимости по задачам, инструментам, моделям и проектам. Установка и активация требуются для отчёта CodeBurn (вкладка \"Оптимизация\").",
  docsUrl: "https://github.com/getagentseal/codeburn#readme",
  category: "context",
  bin: "codeburn",
  systemInstall: (pm) => globalInstallCommand(pm, "codeburn"),
  perRuntime: {
    supported: [],
    installCommand: () => [],
    uninstallCommand: () => [],
  },
};
