import { spawnSync } from "node:child_process";
import type { ToolDef } from "../tools";

function supportsLegacyInstall(): boolean {
  const result = spawnSync("od", ["mcp", "--help"], { encoding: "utf8", timeout: 3_000 });
  return result.status === 0 && /od mcp install <agent>/.test(`${result.stdout}\n${result.stderr}`);
}

/**
 * Плагин инструмента Open Design (nexu-io/open-design): дизайн-воркспейс с
 * собственным MCP-сервером, open-альтернатива Claude Design. Системный пакет -
 * desktop-приложение (DMG с open-design.ai или GitHub Releases, CLI od в
 * комплекте) - ставится вручную. MCP-интеграция ставится собственным
 * через MCP preset. Актуальный CLI запускает сервер командой
 * `od mcp --daemon-url`; legacy `od mcp install <agent>` нельзя вызывать без
 * проверки `od mcp --help`. Разработка плагинов - docs/tools-dev.md.
 */
export const openDesignTool: ToolDef = {
  id: "open-design",
  title: "Open Design",
  description:
    "Дизайн-воркспейс (артборды, слайды, дашборды) с MCP-сервером. CLI od ставится вручную; Console подключает `od mcp --daemon-url` через проектный MCP preset и проверяет capabilities по `od mcp --help`.",
  docsUrl: "https://github.com/nexu-io/open-design",
  category: "design",
  bin: "od",
  systemInstall: () => null,
  mcpPreset: () => ({
    type: "stdio",
    command: "od",
    args: ["mcp", "--daemon-url", "http://127.0.0.1:7456"],
  }),
  perRuntime: {
    supported: ["claude", "codex", "cursor", "kimi", "opencode"],
    available: supportsLegacyInstall,
    installCommand: (runtime) => ["od", "mcp", "install", runtime],
    uninstallCommand: (runtime) => ["od", "mcp", "install", runtime, "--uninstall"],
    notes: { zcode: "Open Design подключается через проектный MCP preset" },
  },
};
