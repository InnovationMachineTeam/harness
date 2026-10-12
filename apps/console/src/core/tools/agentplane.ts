import type { ToolDef } from "../tools";
import { globalInstallCommand } from "../tools";

/** Опциональный инструмент AgentPlane: Harness остаётся источником workflow, AgentPlane ведёт engineering tasks. */
export const agentplaneTool: ToolDef = {
  id: "agentplane",
  title: "AgentPlane",
  description: "Task lifecycle, readiness, verification и ACR. Обновление - кнопка \"Обновить\" в карточке инструмента.",
  docsUrl: "https://github.com/basilisk-labs/agentplane",
  category: "context",
  bin: "agentplane",
  systemInstall: (pm) => globalInstallCommand(pm, "agentplane"),
  systemUpdate: (pm) => globalInstallCommand(pm, "agentplane@latest"),
  // Локальный read-only дашборд графа знания (agentplane context dashboard); порт - литерал из команды в core/dashboards.ts.
  dashboard: { url: "http://127.0.0.1:24287/", label: "Дашборд" },
  uninstallStopsDashboard: true,
};
