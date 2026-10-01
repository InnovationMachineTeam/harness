import type { ToolDef } from "../tools";

/**
 * Плагин инструмента Serena: семантическая навигация по коду через LSP.
 * Разработка плагинов - docs/tools-dev.md.
 */
export const serenaTool: ToolDef = {
  id: "serena",
  title: "Serena",
  description:
    "Семантическая навигация по коду через LSP (40+ языков): символы, ссылки, правки без чтения файлов целиком. Основной доступ - MCP-инструменты рантайма.",
  docsUrl: "https://github.com/oraios/serena",
  category: "code",
  bin: "serena",
  systemInstall: () => ["uv", "tool", "install", "-p", "3.13", "serena-agent"],
  requires: {
    bin: "uv",
    installCommand: (platform) => (platform === "darwin" ? ["brew", "install", "uv"] : null),
  },
  mcpPreset: () => ({
    type: "stdio",
    command: "serena",
    args: ["start-mcp-server", "--context=ide", "--project-from-cwd"],
  }),
  projectInit: {
    // project.yml авто-создаётся; --ls typescript отключает интерактивный
    // диалог языков (в job нет TTY). Для не-TS проектов поправьте флаг.
    init: (dir) => [["serena", "project", "index", "--ls", "typescript"]],
    reinit: (dir) => [["serena", "project", "index", "--ls", "typescript"]],
    update: (dir) => [["serena", "project", "index", "--ls", "typescript"]],
    initMarker: (dir) => `${dir}/.serena/project.yml`,
  },
  dashboard: { url: "http://127.0.0.1:24282/dashboard/index.html", label: "Дашборд Serena" },
};
