import type { ToolDef } from "../tools";

/**
 * Плагин инструмента Headroom: сжатие контекста через локальный прокси.
 * Интеграция под рантайм = запуск общего прокси (detached); сами сессии -
 * `headroom wrap <runtime>` в терминале (wrap запускает CLI интерактивно
 * и в job невозможен). Альтернатива - MCP-сервер.
 */
export const headroomTool: ToolDef = {
  id: "headroom",
  title: "Headroom",
  description:
    "Сжатие контекста перед LLM (JSON/код/логи, профили 50-90%) + общая память агентов. Установка под рантайм запускает общий прокси 127.0.0.1:8787; сессии через него - headroom wrap <runtime> в терминале. Альтернатива - только MCP-сервер (compress/retrieve/stats).",
  docsUrl: "https://github.com/headroomlabs-ai/headroom",
  category: "context",
  bin: "headroom",
  systemInstall: () => ["uv", "tool", "install", "--python", "3.13", "headroom-ai[all]"],
  requires: {
    bin: "uv",
    installCommand: (platform) => (platform === "darwin" ? ["brew", "install", "uv"] : null),
  },
  hasModes: true,
  dashboardCommand: ["headroom", "proxy", "--port", "8787"],
  uninstallStopsDashboard: true,
  mcpPreset: (params) =>
    params.mode === "mcp"
      ? { type: "stdio", command: "headroom", args: ["mcp", "serve", "--proxy-url", "http://127.0.0.1:8787"] }
      : null,
  perRuntime: {
    supported: ["claude", "codex", "zcode", "kimi", "opencode"],
    detachedInstall: true,
    notes: {
      cursor: "Cursor настраивается вручную (ANTHROPIC_BASE_URL/OPENAI_BASE_URL на локальный прокси)",
    },
    // "интеграция" = запуск общего прокси (один на все рантаймы); сами
    // сессии запускает пользователь: headroom wrap <runtime>
    installCommand: () => [],
    uninstallCommand: () => [],
  },
  dashboard: {
    url: "http://127.0.0.1:8787/dashboard",
    label: "Дашборд Headroom",
    // Headroom ставит x-frame-options: DENY - iframe грузит embed-прокси
    // (app/dashboard/[[...path]], same-origin, заголовок фрейминга снят)
    embedPath: "/dashboard",
  },
};
