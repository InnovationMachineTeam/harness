import { MCP_PRESETS } from "./plugins";
import { toolById } from "./tools";
import type { ConsoleState } from "./state";

/**
 * Лейблы происхождения MCP-серверов (по образцу лейблов навыков):
 * - tool: сервер инструмента (mcpPreset из ToolDef, имя = id инструмента);
 * - plugin: имя числится в mcp включённого установленного плагина;
 * - preset: имя из каталога пресетов (стандартная установка "Установить MCP");
 * - manual: добавлен вручную (форма реестра).
 * Атрибуция по имени: реестр MCP не хранит origin - источник восстанавливается
 * из текущего состояния плагинов, инструментов и каталога пресетов.
 */

export type McpLabel = "preset" | "plugin" | "tool" | "manual";

type LabelState = Pick<ConsoleState, "plugins">;

export function mcpServerLabel(state: LabelState, name: string): McpLabel {
  if (toolById(name)?.mcpPreset) return "tool";
  for (const plugin of Object.values(state.plugins.installed)) {
    if (!plugin.enabled) continue;
    if (plugin.mcp?.some((contribution) => contribution.name === name)) return "plugin";
  }
  if (MCP_PRESETS.some((preset) => preset.name === name)) return "preset";
  return "manual";
}
