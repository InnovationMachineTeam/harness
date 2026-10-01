import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { McpServerDef, TargetSyncResult } from "./types";

/** Задачи, для которых можно выбрать конкретный рантайм. */
export type TaskKind = "promptExecution" | "skillCreation";

export type TaskRuntimes = Record<TaskKind, string | null>;

/** Менеджер глобальных npm-пакетов (выбор в setup.sh / настройках инструментов). */
export type PackageManager = "bun" | "npm";

/** Параметры установки инструмента (значения по умолчанию - в core/tools.ts). */
export interface ToolInstallParams {
  /** Область per-runtime интеграции: глобально (~) или в проект (repo). */
  scope?: "global" | "project";
  /** Graphify+Claude: блокировать первый "сырой" read сессии. */
  strict?: boolean;
  /** qmd: проиндексировать рабочие папки (qmd collection add). */
  indexWorkspaces?: boolean;
  /** Headroom: режим интеграции - прокси-wrap или MCP. */
  mode?: "wrap" | "mcp";
}

/** Запись об установленном инструменте (жизненный цикл - /api/tools/action). */
export interface InstalledTool {
  runtimes: string[];
  params: ToolInstallParams;
  at: string;
  /** Выключен (off) - интеграция снята, системный пакет остаётся. */
  enabled: boolean;
}

/** Состояние консоли: реестр MCP, оверлеи навыков, рабочие папки, результаты синка. */
export interface ConsoleState {
  mcp: { servers: Record<string, McpServerDef> };
  skills: {
    /** Глобальный toggle "Использовать глобальные навыки" (значение по умолчанию для всех рантаймов). */
    useGlobal: boolean;
    /** Per-skill значение по умолчанию (установленные harness-навыки):
     *  действует для всех рантаймов; перекрывается override конкретного рантайма. */
    defaults: Record<string, boolean>;
    runtimeOverrides: Record<string, Record<string, boolean>>;
  };
  /** Рантайм по умолчанию (★) для запуска промтов; null - не выбран. */
  defaultRuntime: string | null;
  /** Рантайм под конкретные задачи; null = "по умолчанию" (defaultRuntime). */
  settings: { taskRuntimes: TaskRuntimes };
  /** Плагины: бандлы MCP(+навыков); включённый добавляет MCP в общий реестр. */
  plugins: {
    installed: Record<string, import("./plugins").PluginDef & { enabled: boolean }>;
    marketplaces: { name: string; url: string }[];
  };
  workspaces: {
    mandatory: string;
    additional: string[];
    /** Папки, для которых собирается OpenWiki (виики пишется в <dir>/openwiki). */
    openwiki: string[];
    /** Папки, для которых собирается граф Graphify (<dir>/graphify-out). */
    graphify: string[];
    /** Папки, чьи документы показываются во вкладке Docs ("Память"). */
    docs: string[];
  };
  /** Инструменты экономии контекста: реестр и жизненный цикл - core/tools.ts. */
  tools: {
    installed: Record<string, InstalledTool>;
    /** Автозапуск дашбордов (serena/headroom): консоль запускает инстанс при загрузке инструментов. */
    autostart: Record<string, boolean>;
  };
  /**
   * LLM-провайдер для сборки OpenWiki (передаётся env-переменными в CLI):
   * пресет + ключ/model (по умолчанию - локальный Ollama).
   */
  openwikiLlm?: {
    preset?: string;
    apiKey?: string;
    baseUrl?: string;
    modelId?: string;
  };
  /** LLM-бэкенд сборки Graphify (env-ключ; auto - из окружения). */
  graphifyLlm?: {
    preset?: string;
    apiKey?: string;
  };
  lastMcpSync: Record<string, TargetSyncResult>;
}

/** Эффективный рантайм для задачи: назначенный или рантайм по умолчанию (★). */
export function resolveTaskRuntime(state: ConsoleState, task: TaskKind): string | null {
  return state.settings.taskRuntimes[task] ?? state.defaultRuntime ?? null;
}

export function stateFilePath(repoRoot: string): string {
  return process.env.HARNESS_CONSOLE_STATE ?? path.join(repoRoot, ".agents", "console", "state.json");
}

export function defaultState(repoRoot: string): ConsoleState {
  return {
    mcp: { servers: {} },
    skills: { useGlobal: true, defaults: {}, runtimeOverrides: {} },
    defaultRuntime: null,
    settings: { taskRuntimes: { promptExecution: null, skillCreation: null } },
    plugins: { installed: {}, marketplaces: [] },
    workspaces: {
      mandatory: repoRoot,
      // основные рабочие папки: доки репозитория и локальные проекты (sources)
      additional: [path.join(repoRoot, "docs"), path.join(repoRoot, "sources")],
      openwiki: [],
      graphify: [],
      docs: [],
    },
    tools: { installed: {}, autostart: {} },
    openwikiLlm: {
      preset: "openai-compatible",
      apiKey: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "",
    },
    lastMcpSync: {},
  };
}

/** Разворот `~`/`~/…` в домашний каталог: в state.json пути можно хранить портабельно. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** Загрузка с защитой от частичного или повреждённого файла: недостающее берётся из значений по умолчанию. */
export async function loadConsoleState(repoRoot: string): Promise<ConsoleState> {
  const fallback = defaultState(repoRoot);
  try {
    const raw = JSON.parse(await readFile(stateFilePath(repoRoot), "utf8")) as Partial<ConsoleState> & {
      skills?: { useGlobal?: boolean; defaults?: Record<string, boolean>; runtimeOverrides?: Record<string, Record<string, boolean>> };
    };
    return {
      mcp: { servers: raw.mcp?.servers ?? fallback.mcp.servers },
      skills: {
        // старый формат с per-skill defaults мигрируем: остаётся один глобальный toggle
        useGlobal: raw.skills?.useGlobal ?? true,
        defaults: raw.skills?.defaults ?? {},
        runtimeOverrides: raw.skills?.runtimeOverrides ?? fallback.skills.runtimeOverrides,
      },
      defaultRuntime: raw.defaultRuntime ?? null,
      settings: {
        taskRuntimes: {
          promptExecution: raw.settings?.taskRuntimes?.promptExecution ?? null,
          skillCreation: raw.settings?.taskRuntimes?.skillCreation ?? null,
        },
      },
      plugins: {
        installed: raw.plugins?.installed ?? {},
        marketplaces: raw.plugins?.marketplaces ?? [],
      },
      workspaces: {
        mandatory: raw.workspaces?.mandatory ? expandHome(raw.workspaces.mandatory) : fallback.workspaces.mandatory,
        additional: (raw.workspaces?.additional ?? fallback.workspaces.additional).map(expandHome),
        openwiki: (raw.workspaces?.openwiki ?? fallback.workspaces.openwiki).map(expandHome),
        graphify: (raw.workspaces?.graphify ?? fallback.workspaces.graphify).map(expandHome),
        docs: (raw.workspaces?.docs ?? fallback.workspaces.docs).map(expandHome),
      },
      tools: {
        installed: raw.tools?.installed ?? {},
        autostart: raw.tools?.autostart ?? {},
      },
      openwikiLlm: {
        preset: raw.openwikiLlm?.preset ?? "openai-compatible",
        apiKey: raw.openwikiLlm?.apiKey ?? "ollama",
        baseUrl: raw.openwikiLlm?.baseUrl ?? "http://localhost:11434/v1",
        modelId: raw.openwikiLlm?.modelId ?? "",
      },
      graphifyLlm: {
        preset: raw.graphifyLlm?.preset ?? "auto",
        apiKey: raw.graphifyLlm?.apiKey ?? "",
      },
      lastMcpSync: raw.lastMcpSync ?? {},
    };
  } catch {
    return fallback;
  }
}

/** Атомарная запись: tmp-файл в том же каталоге + rename. */
export async function saveConsoleState(repoRoot: string, state: ConsoleState): Promise<void> {
  const file = stateFilePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export function workspaceDirs(state: ConsoleState): string[] {
  return [state.workspaces.mandatory, ...state.workspaces.additional].filter(Boolean);
}

export interface WorkspacesValidation {
  ok: boolean;
  errors: string[];
  value?: { mandatory: string; additional: string[]; openwiki: string[]; graphify: string[]; docs: string[] };
}

/**
 * Валидация рабочих папок: обязательная - ровно одна, абсолютный путь,
 * существует; дополнительные - абсолютные, существуют, без дублей.
 * `~`/`~/…` разворачиваются в домашний каталог до проверок - в состояние
 * попадают только абсолютные пути.
 * openwiki/graphify - подмножество списка папок: посторонние и убранные
 * из списка пути отбрасываются молча (снятие тоггла при удалении папки).
 */
export function validateWorkspaces(input: {
  mandatory?: string;
  additional?: string[];
  openwiki?: string[];
  graphify?: string[];
  docs?: string[];
}): WorkspacesValidation {
  const errors: string[] = [];
  const mandatory = expandHome(input.mandatory?.trim() ?? "");
  if (!mandatory) {
    errors.push("Обязательная директория не задана");
  } else if (!path.isAbsolute(mandatory)) {
    errors.push(`Обязательная директория должна быть абсолютным путём: ${mandatory}`);
  }
  const additional: string[] = [];
  for (const dir of input.additional ?? []) {
    const t = expandHome(dir.trim());
    if (!t) continue;
    if (!path.isAbsolute(t)) errors.push(`Путь должен быть абсолютным: ${t}`);
    if (additional.includes(t) || t === mandatory) errors.push(`Дубликат папки: ${t}`);
    if (!errors.some((e) => e.includes(t))) additional.push(t);
  }
  const folders = new Set([mandatory, ...additional].filter(Boolean));
  const subset = (dirs: string[] | undefined): string[] => {
    const picked: string[] = [];
    for (const dir of dirs ?? []) {
      const t = expandHome(dir.trim());
      if (!t || !folders.has(t) || picked.includes(t)) continue;
      picked.push(t);
    }
    return picked;
  };
  const openwiki = subset(input.openwiki);
  const graphify = subset(input.graphify);
  const docs = subset(input.docs);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: { mandatory: mandatory!, additional, openwiki, graphify, docs } };
}
