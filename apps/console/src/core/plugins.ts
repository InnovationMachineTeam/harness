import type { McpServerDef, McpTransport } from "./types";
import type { ConsoleState } from "./state";

/**
 * Плагины консоли: бандл "MCP-серверы + (заявленные) навыки". Включённый
 * плагин добавляет свои MCP-серверы в общий реестр (и синк в конфиги
 * рантаймов); выключенный - убирает. Источники: builtin-каталог и
 * marketplace-манифесты (https-URL с валидацией хоста).
 */

export interface PluginMcpContribution {
  name: string;
  transport: McpTransport;
}

export interface PluginDef {
  id: string;
  displayName: string;
  description?: string;
  /** MCP-серверы, добавляемые в общий реестр при включении плагина. */
  mcp: PluginMcpContribution[];
  /** Навыки плагина (справочно: имена harness-навыков/пакетов skills.sh). */
  skills?: { name: string; description?: string }[];
  /** Хуки жизненного цикла (install/remove/enable/disable); cwd - обязательная рабочая папка. */
  hooks?: import("./lifecycleHooks").LifecycleHooks;
  /** Источник: builtin или marketplace name. */
  source: string;
  url?: string;
}

/** Пресет каталога MCP (страница "MCP" → "Установить MCP"). */
export interface McpPreset {
  name: string;
  displayName: string;
  description: string;
  transport: McpTransport;
  docsUrl?: string;
  /** Категория каталога; "design" - инструменты дизайна для панели вкладки "Дизайн". */
  category?: "design";
}

export const MCP_PRESETS: McpPreset[] = [
  {
    name: "context7",
    displayName: "Context7",
    description: "Актуальная документация библиотек в промпте (Upstash). Можно ставить и как навык skills.sh.",
    transport: { type: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    docsUrl: "https://context7.com/",
  },
  {
    name: "deepwiki",
    displayName: "DeepWiki",
    description: "Документация любых GitHub-репозиториев (deepwiki.com) - удалённый HTTP MCP.",
    transport: { type: "http", url: "https://mcp.deepwiki.com/" },
    docsUrl: "https://deepwiki.com/",
  },
  {
    name: "figma",
    displayName: "Figma MCP",
    category: "design",
    description:
      "Официальный удалённый MCP Figma: чтение макетов, переменных и кода для design-to-code; запись на канву. Авторизация OAuth - при первом вызове в рантайме (/mcp).",
    transport: { type: "http", url: "https://mcp.figma.com/mcp" },
    docsUrl: "https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server",
  },
  {
    name: "open-design",
    displayName: "Open Design",
    category: "design",
    description:
      "MCP-сервер Open Design: файлы и артефакты дизайн-проектов агенту (list_projects, get_artifact, …). Требуется CLI od из desktop-приложения Open Design (Настройки → Инструменты).",
    transport: { type: "stdio", command: "od", args: ["mcp", "--daemon-url", "http://127.0.0.1:7456"] },
    docsUrl: "https://github.com/nexu-io/open-design",
  },
  {
    name: "webmcp",
    displayName: "WebMCP",
    category: "design",
    description: "Соединяет сайты, встроившие виджет WebMCP, с агентом (webmcp.dev).",
    transport: { type: "stdio", command: "npx", args: ["-y", "@jason.today/webmcp@latest", "--mcp"] },
    docsUrl: "https://webmcp.dev/",
  },
  {
    name: "playwright",
    displayName: "Playwright MCP",
    category: "design",
    description: "Автоматизация браузера: навигация, клики, формы, скриншоты.",
    transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
    docsUrl: "https://github.com/microsoft/playwright-mcp",
  },
  {
    name: "excalidraw",
    displayName: "Excalidraw MCP",
    category: "design",
    description:
      "Официальный MCP Excalidraw: вайрфреймы и hand-drawn диаграммы в формате .excalidraw. Удалённый HTTP-сервер, ключи не нужны.",
    transport: { type: "http", url: "https://mcp.excalidraw.com" },
    docsUrl: "https://github.com/excalidraw/excalidraw-mcp",
  },
  {
    name: "google-design",
    displayName: "Google Design MCP",
    category: "design",
    description:
      "Google Design MCP: генерация цветовых схем, извлечение бренд-цветов из изображений, поиск шрифтов Google Fonts и Material Symbols. Ключ Gemini не обязателен; при необходимости - заголовок x-goog-api-key (шестерёнка на карточке сервера).",
    transport: { type: "http", url: "https://design.googleapis.com/mcp" },
    docsUrl: "https://developers.google.com/design-mcp",
  },
  {
    name: "stitch",
    displayName: "Stitch MCP",
    category: "design",
    description:
      "Официальный MCP Google Stitch (CLI @google/stitch, stdio): Canvas-проекты и экраны, генерация вариантов, синхронизация DESIGN.md, захват живых маршрутов и локальный UI-ревью. Требуется авторизация CLI: stitch login (Google OAuth) или переменная STITCH_API_KEY.",
    transport: { type: "stdio", command: "stitch", args: ["mcp", "start"] },
    docsUrl: "https://stitch.withgoogle.com/docs/cli/mcp-and-skills/",
  },
  {
    name: "serena",
    displayName: "Serena",
    description:
      "Семантические LSP-инструменты по коду (find_symbol, replace_symbol, …) - навигация и правки без чтения файлов целиком. Требуется установленный CLI (Настройки → Инструменты).",
    transport: { type: "stdio", command: "serena", args: ["start-mcp-server", "--context=ide", "--project-from-cwd"] },
    docsUrl: "https://github.com/oraios/serena",
  },
  {
    name: "qmd",
    displayName: "qmd",
    description:
      "Локальный гибридный поиск по markdown (BM25 + векторы). Требуется установленный CLI (Настройки → Инструменты).",
    transport: { type: "stdio", command: "qmd", args: ["mcp"] },
    docsUrl: "https://github.com/tobi/qmd",
  },
  {
    name: "codegraph",
    displayName: "CodeGraph",
    description:
      "Knowledge graph кода: codegraph_explore вместо цепочек grep/Read. Требуется установленный CLI (Настройки → Инструменты).",
    transport: { type: "stdio", command: "codegraph", args: ["serve", "--mcp"] },
    docsUrl: "https://github.com/colbymchenry/codegraph",
  },
];

/**
 * Пресеты stdio-типа `npx -y …` адаптируются под выбранный менеджер пакетов:
 * bun → `bunx …` (ставит без подтверждения, -y не нужен), npm → как есть.
 * Выбор хранится в .agents/console/package-manager.json (core/tools.ts).
 */
export function mcpPresetsForPm(pm: "bun" | "npm"): McpPreset[] {
  return MCP_PRESETS.map((preset) => ({ ...preset, transport: transportForPm(preset.transport, pm) }));
}

function transportForPm(transport: McpTransport, pm: "bun" | "npm"): McpTransport {
  if (pm === "bun" && transport.type === "stdio" && transport.command === "npx") {
    return { ...transport, command: "bunx", args: (transport.args ?? []).filter((a) => a !== "-y") };
  }
  return transport;
}

/** Встроенный каталог плагинов. */
export const BUILTIN_PLUGINS: PluginDef[] = [
  {
    id: "chrome-devtools",
    displayName: "Chrome DevTools",
    description:
      "MCP chrome-devtools-mcp из github.com/ChromeDevTools/chrome-devtools-mcp: диагностика страниц, performance-трейсы, скриншоты, консоль и сеть настоящего Chrome.",
    mcp: [
      {
        name: "chrome-devtools",
        transport: { type: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
      },
    ],
    source: "builtin",
    url: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
  },
];

/**
 * Marketplace-манифест: { "plugins": PluginDef[] } по https-URL.
 * SSRF-защита: только http/https, запрет localhost/приватных/зарезервированных
 * адресов, таймаут и лимит размера.
 */
export async function fetchMarketplacePlugins(url: string): Promise<PluginDef[]> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("marketplace: только http/https");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new Error("marketplace: частные/зарезервированные адреса запрещены");
  }
  const res = await fetch(parsed, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`marketplace: HTTP ${res.status}`);
  const text = (await res.text()).slice(0, 512_000);
  const manifest = JSON.parse(text) as { plugins?: Partial<PluginDef>[] };
  return (manifest.plugins ?? [])
    .filter((p): p is Partial<PluginDef> => Boolean(p?.id))
    .map((p) => normalizePlugin(p, `marketplace:${parsed.hostname}`))
    .filter((p): p is PluginDef => p !== null);
}

/** Приведение записи манифеста к PluginDef с валидацией MCP-транспортов. */
function normalizePlugin(raw: Partial<PluginDef>, source: string): PluginDef | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/.test(id)) return null;
  const mcp: PluginMcpContribution[] = [];
  for (const contribution of raw.mcp ?? []) {
    const name = typeof contribution?.name === "string" ? contribution.name.trim() : "";
    const t = contribution?.transport;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) || !t) continue;
    if (t.type === "stdio" && typeof t.command === "string" && t.command.trim()) {
      const transport: McpTransport = {
        type: "stdio",
        command: t.command.trim(),
        ...(Array.isArray(t.args) ? { args: t.args.map(String) } : {}),
        ...(t.env && typeof t.env === "object" && !Array.isArray(t.env) ? { env: t.env as Record<string, string> } : {}),
      };
      mcp.push({ name, transport });
    } else if (t.type === "http" && typeof t.url === "string" && /^https?:\/\//.test(t.url)) {
      mcp.push({ name, transport: { type: "http", url: t.url.trim() } });
    }
  }
  return {
    id,
    displayName: typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName.trim() : id,
    description: typeof raw.description === "string" ? raw.description.slice(0, 500) : undefined,
    mcp,
    skills: Array.isArray(raw.skills)
      ? raw.skills
          .filter((s) => typeof s?.name === "string")
          .map((s) => ({ name: String(s.name).slice(0, 80), description: typeof s?.description === "string" ? s.description.slice(0, 200) : undefined }))
      : undefined,
    source,
    url: typeof raw.url === "string" ? raw.url : undefined,
  };
}

/** Установить плагин в состояние (enabled=true - сразу добавляет MCP в реестр). */
export function installPlugin(state: ConsoleState, plugin: PluginDef): void {
  state.plugins.installed[plugin.id] = { ...plugin, enabled: true };
  contributeMcp(state, plugin, true);
}

/** Выключить плагин: убрать его MCP из реестра; включить - вернуть. */
export function setPluginEnabled(state: ConsoleState, pluginId: string, enabled: boolean): boolean {
  const plugin = state.plugins.installed[pluginId];
  if (!plugin) return false;
  plugin.enabled = enabled;
  contributeMcp(state, plugin, enabled);
  return true;
}

/** Удалить плагин: выключить и убрать запись. */
export function uninstallPlugin(state: ConsoleState, pluginId: string): boolean {
  const plugin = state.plugins.installed[pluginId];
  if (!plugin) return false;
  contributeMcp(state, plugin, false);
  delete state.plugins.installed[pluginId];
  return true;
}

/** Добавить/убрать MCP-серверы плагина из общего реестра. */
function contributeMcp(state: ConsoleState, plugin: PluginDef, add: boolean): void {
  for (const contribution of plugin.mcp) {
    if (add) {
      state.mcp.servers[contribution.name] = {
        name: contribution.name,
        transport: contribution.transport,
        enabled: true,
        runtimeOverrides: undefined,
      };
    } else {
      // убираем только если это всё ещё сервер плагина (пользователь мог заменить)
      const existing = state.mcp.servers[contribution.name];
      if (existing && sameTransport(existing.transport, contribution.transport)) {
        delete state.mcp.servers[contribution.name];
      }
    }
  }
}

function sameTransport(a: McpTransport, b: McpTransport): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Эффективный список плагинов для UI: установленные + каталоги marketplace. */
export function pluginById(state: ConsoleState, id: string): (PluginDef & { enabled: boolean }) | undefined {
  return state.plugins.installed[id];
}
