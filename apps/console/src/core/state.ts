import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ProviderVerification } from "./providers";
import { FALLBACK_PROVIDER_ID } from "./providers";
import type { McpServerDef, TargetSyncResult } from "./types";

/** Задачи, для которых можно выбрать конкретный рантайм. */
export type TaskKind = "promptExecution" | "skillCreation" | "optimization";

export type TaskRuntimes = Record<TaskKind, string | null>;

/** Отчёт оптимизации: аналитический срез статистики консоли. */
export type OptimizationKind = "claudeInsights" | "codeburn";

export const OPTIMIZATION_KINDS: OptimizationKind[] = ["claudeInsights", "codeburn"];

/** Вес рекомендации в отчёте оптимизации. */
export type OptimizationImpact = "high" | "medium" | "low";

export interface OptimizationRecommendation {
  id: string;
  title: string;
  detail: string;
  impact?: OptimizationImpact;
}

/** Отчёт вкладки оптимизации: рекомендации и время генерации. */
export interface OptimizationReport {
  generatedAt: string;
  recommendations: OptimizationRecommendation[];
}

/** Состояние оптимизации по отчётам: последний отчёт и время последнего запуска. */
export interface OptimizationSettings {
  reports: Record<OptimizationKind, OptimizationReport | null>;
  lastOptimizedAt: Record<OptimizationKind, string | null>;
}

const OPTIMIZATION_IMPACTS: OptimizationImpact[] = ["high", "medium", "low"];

/** Нормализация отчёта из файла состояния или запроса: битые записи отбрасываются. */
export function normalizeOptimizationReport(value: unknown): OptimizationReport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { generatedAt?: unknown; recommendations?: unknown };
  if (typeof raw.generatedAt !== "string" || Number.isNaN(Date.parse(raw.generatedAt))) return null;
  if (!Array.isArray(raw.recommendations)) return null;
  const recommendations: OptimizationRecommendation[] = [];
  for (const item of raw.recommendations.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { id?: unknown; title?: unknown; detail?: unknown; impact?: unknown };
    if (typeof rec.id !== "string" || !rec.id.trim()) continue;
    if (typeof rec.title !== "string" || !rec.title.trim()) continue;
    if (typeof rec.detail !== "string" || !rec.detail.trim()) continue;
    recommendations.push({
      id: rec.id.trim().slice(0, 80),
      title: rec.title.trim().slice(0, 200),
      detail: rec.detail.trim().slice(0, 2000),
      impact: OPTIMIZATION_IMPACTS.includes(rec.impact as OptimizationImpact) ? (rec.impact as OptimizationImpact) : undefined,
    });
  }
  return { generatedAt: raw.generatedAt, recommendations };
}

/** Нормализация settings.optimization из запроса или файла состояния. */
export function normalizeOptimization(value: unknown): OptimizationSettings {
  const result: OptimizationSettings = {
    reports: { claudeInsights: null, codeburn: null },
    lastOptimizedAt: { claudeInsights: null, codeburn: null },
  };
  if (!value || typeof value !== "object") return result;
  const raw = value as { reports?: unknown; lastOptimizedAt?: unknown };
  if (raw.reports && typeof raw.reports === "object") {
    const reports = raw.reports as Record<string, unknown>;
    for (const kind of OPTIMIZATION_KINDS) {
      result.reports[kind] = normalizeOptimizationReport(reports[kind]);
    }
  }
  if (raw.lastOptimizedAt && typeof raw.lastOptimizedAt === "object") {
    const stamps = raw.lastOptimizedAt as Record<string, unknown>;
    for (const kind of OPTIMIZATION_KINDS) {
      const value2 = stamps[kind];
      result.lastOptimizedAt[kind] = typeof value2 === "string" && !Number.isNaN(Date.parse(value2)) ? value2 : null;
    }
  }
  return result;
}

/** Способ оплаты рантайма или провайдера: без подписки | тариф каталога | Pay as You Go. */
export type BillingMode = "none" | "plan" | "payg";

/** Выбор на вкладке «Подписки»: mode "plan" требует planId из каталога .agents/pricing/subscriptions.json. */
export interface BillingSelection {
  mode: BillingMode;
  planId?: string;
}

/** Пополнение Pay as You Go (ключ deposits - "runtime:<id>" или "provider:<id>"). */
export interface BillingDeposit {
  id: string;
  amount: number;
  currency: string;
  /** ISO-дата зачисления. */
  at: string;
  note?: string;
}

export interface BillingSettings {
  runtimes: Record<string, BillingSelection>;
  providers: Record<string, BillingSelection>;
  deposits: Record<string, BillingDeposit[]>;
}

const BILLING_MODES: BillingMode[] = ["none", "plan", "payg"];

function normalizeBillingSelection(value: unknown): BillingSelection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { mode?: unknown; planId?: unknown };
  if (typeof raw.mode !== "string" || !BILLING_MODES.includes(raw.mode as BillingMode)) return null;
  if (raw.mode === "plan") {
    if (typeof raw.planId !== "string" || !raw.planId.trim()) return null;
    return { mode: "plan", planId: raw.planId.trim().slice(0, 120) };
  }
  return { mode: raw.mode as BillingMode };
}

function normalizeBillingSelections(value: unknown): Record<string, BillingSelection> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, BillingSelection> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const selection = normalizeBillingSelection(raw);
    if (selection) result[id] = selection;
  }
  return result;
}

function normalizeDeposits(value: unknown): Record<string, BillingDeposit[]> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, BillingDeposit[]> = {};
  for (const [key, rawList] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawList)) continue;
    const deposits: BillingDeposit[] = [];
    for (const raw of rawList) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { id?: unknown; amount?: unknown; currency?: unknown; at?: unknown; note?: unknown };
      if (typeof item.id !== "string" || typeof item.amount !== "number" || !Number.isFinite(item.amount)) continue;
      if (typeof item.currency !== "string" || !item.currency.trim()) continue;
      if (typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) continue;
      deposits.push({
        id: item.id.slice(0, 80),
        amount: item.amount,
        currency: item.currency.trim().slice(0, 8),
        at: item.at,
        note: typeof item.note === "string" ? item.note.slice(0, 200) : undefined,
      });
    }
    result[key] = deposits;
  }
  return result;
}

/** Нормализация settings.billing из запроса или файла состояния: неизвестные mode и битые записи отбрасываются. */
export function normalizeBilling(value: unknown): BillingSettings {
  if (!value || typeof value !== "object") return { runtimes: {}, providers: {}, deposits: {} };
  const raw = value as { runtimes?: unknown; providers?: unknown; deposits?: unknown };
  return {
    runtimes: normalizeBillingSelections(raw.runtimes),
    providers: normalizeBillingSelections(raw.providers),
    deposits: normalizeDeposits(raw.deposits),
  };
}

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
  /**
   * Провайдер AI SDK по умолчанию (★ на вкладке "Провайдеры") для диалога
   * вкладки "Агент"; null - действует Ollama (resolveDefaultProvider).
   */
  defaultProvider: string | null;
  /** Рантайм под конкретные задачи; null = "по умолчанию" (defaultRuntime). */
  settings: {
    taskRuntimes: TaskRuntimes;
    /**
     * Последний выбор исполнителя вкладки "Агент": "provider", "provider:<id>"
     * или id рантайма; null - "provider". Выбор главнее провайдера по умолчанию.
     */
    agentExecutor: string | null;
    /**
     * Сколько последних реплик direct-чата отправляется модели;
     * null - значение по умолчанию (20), 0 - без ограничения.
     */
    agentHistoryLimit: number | null;
    workflows: {
      privacy: "full" | "metadata" | "aggregates";
      workspacePrivacy: Record<string, "full" | "metadata" | "aggregates">;
      capabilities: {
        defaultPolicy: "block" | "warn";
        workspacePolicies: Record<string, "block" | "warn">;
      };
      designProviders: Record<string, string[]>;
      /** Легаси-подписка workflow (редактировалась в общих настройках); заменена per-runtime settings.billing. */
      subscription: { name: string; price: number; currency: string; period: string } | null;
    };
    /** Подписки и Pay as You Go по рантаймам и провайдерам (вкладка «Подписки» рантайма, модалка провайдера). */
    billing: BillingSettings;
    /** Индекс сессий (.agents/console/sessions.sqlite). */
    sessionIndex: {
      /** Писать тексты сообщений в индекс для полнотекстового поиска; false - только метаданные. */
      contentSearch: boolean;
    };
    /** Отчёты оптимизации (вкладка "Настройки → Оптимизация") и время последнего запуска. */
    optimization: OptimizationSettings;
  };
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
    /** Папки, для которых собирается граф Graphify (хранилище graphify/<имя>/graphify-out). */
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
   * пресет + ключ/model (по умолчанию - локальный Ollama). providerId -
   * провайдер из реестра консоли, если настройки выбраны из его карточки.
   */
  openwikiLlm?: {
    preset?: string;
    apiKey?: string;
    baseUrl?: string;
    modelId?: string;
    providerId?: string;
  };
  /** LLM-бэкенд сборки Graphify (env-ключ; auto - из окружения; modelId - --model CLI). */
  graphifyLlm?: {
    preset?: string;
    apiKey?: string;
    providerId?: string;
    modelId?: string;
  };
  /**
   * Реестр LLM-провайдеров консоли: результат проверки по id пресета
   * (пресеты - core/providers.ts; настройки - .agents/providers/<id>/) и экспорт для LangGraph.
   */
  providers: {
    entries: Record<string, ProviderVerification>;
    /** Последний экспорт провайдера в .agents/console/langgraph.env. */
    langgraphExport: { providerId: string; at: string } | null;
  };
  lastMcpSync: Record<string, TargetSyncResult>;
}

/** Эффективный рантайм для задачи: назначенный или рантайм по умолчанию (★). */
export function resolveTaskRuntime(state: ConsoleState, task: TaskKind): string | null {
  return state.settings.taskRuntimes[task] ?? state.defaultRuntime ?? null;
}

/** Провайдер AI SDK по умолчанию для вкладки "Агент": выбор (★) или Ollama. */
export function resolveDefaultProvider(state: ConsoleState): string {
  return state.defaultProvider ?? FALLBACK_PROVIDER_ID;
}

/** Исполнитель оптимизации: назначенный или провайдер по умолчанию (Ollama при отсутствии выбора). */
export function resolveOptimizationExecutor(state: ConsoleState): string {
  return state.settings.taskRuntimes.optimization ?? `provider:${resolveDefaultProvider(state)}`;
}

/** Валидация сохранённого исполнителя агента: "provider", "provider:<id>" или id рантайма; иное - null. */
export function normalizeAgentExecutor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (trimmed === "provider") return trimmed;
  const id = trimmed.startsWith("provider:") ? trimmed.slice("provider:".length) : trimmed;
  return /^[a-z0-9][a-z0-9-]*$/.test(id) ? trimmed : null;
}

/** Лимит реплик истории direct-чата по умолчанию. */
export const DEFAULT_AGENT_HISTORY_LIMIT = 20;

/** Валидация лимита истории: целое 0..500; иное - null (значение по умолчанию). */
export function normalizeAgentHistoryLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 500 ? value : null;
}

/** Эффективный лимит реплик истории direct-чата; 0 - без ограничения. */
export function agentHistoryLimit(state: ConsoleState): number {
  return state.settings.agentHistoryLimit ?? DEFAULT_AGENT_HISTORY_LIMIT;
}

export function stateFilePath(repoRoot: string): string {
  return process.env.HARNESS_CONSOLE_STATE ?? path.join(repoRoot, ".agents", "console", "state.json");
}

export function defaultState(repoRoot: string): ConsoleState {
  return {
    mcp: { servers: {} },
    skills: { useGlobal: true, defaults: {}, runtimeOverrides: {} },
    defaultRuntime: null,
    defaultProvider: FALLBACK_PROVIDER_ID,
    settings: {
      taskRuntimes: { promptExecution: null, skillCreation: null, optimization: null },
      agentExecutor: null,
      agentHistoryLimit: null,
      workflows: {
        privacy: "metadata",
        workspacePrivacy: {},
        capabilities: { defaultPolicy: "block", workspacePolicies: {} },
        designProviders: {
          claude: ["claude-design", "open-design", "figma"],
          codex: ["open-design", "figma"], cursor: ["open-design", "figma"], kimi: ["open-design", "figma"], zcode: ["open-design", "figma"], opencode: ["open-design", "figma"],
        },
        subscription: null,
      },
      billing: { runtimes: {}, providers: {}, deposits: {} },
      sessionIndex: { contentSearch: true },
      optimization: normalizeOptimization(null),
    },
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
    providers: { entries: {}, langgraphExport: null },
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
  const stateFile = stateFilePath(repoRoot);
  const consoleDir = path.join(repoRoot, ".agents", "console");
  if (stateFile !== process.env.HARNESS_CONSOLE_STATE && !stateFile.startsWith(consoleDir + path.sep)) {
    throw new Error("путь файла состояния вне каталога консоли: " + stateFile);
  }
  try {
    const raw = JSON.parse(await readFile(stateFile, "utf8")) as Partial<ConsoleState> & {
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
      defaultProvider: raw.defaultProvider ?? FALLBACK_PROVIDER_ID,
      settings: {
        taskRuntimes: {
          promptExecution: raw.settings?.taskRuntimes?.promptExecution ?? null,
          skillCreation: raw.settings?.taskRuntimes?.skillCreation ?? null,
          optimization: raw.settings?.taskRuntimes?.optimization ?? null,
        },
        agentExecutor: normalizeAgentExecutor(raw.settings?.agentExecutor),
        agentHistoryLimit: normalizeAgentHistoryLimit(raw.settings?.agentHistoryLimit),
        workflows: {
          privacy: raw.settings?.workflows?.privacy ?? fallback.settings.workflows.privacy,
          workspacePrivacy: raw.settings?.workflows?.workspacePrivacy ?? {},
          capabilities: {
            defaultPolicy: raw.settings?.workflows?.capabilities?.defaultPolicy ?? "block",
            workspacePolicies: raw.settings?.workflows?.capabilities?.workspacePolicies ?? {},
          },
          designProviders: raw.settings?.workflows?.designProviders ?? fallback.settings.workflows.designProviders,
          subscription: raw.settings?.workflows?.subscription ?? null,
        },
        billing: normalizeBilling(raw.settings?.billing),
        sessionIndex: { contentSearch: raw.settings?.sessionIndex?.contentSearch ?? true },
        optimization: normalizeOptimization(raw.settings?.optimization),
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
        providerId: raw.openwikiLlm?.providerId,
      },
      graphifyLlm: {
        preset: raw.graphifyLlm?.preset ?? "auto",
        apiKey: raw.graphifyLlm?.apiKey ?? "",
        providerId: raw.graphifyLlm?.providerId,
        modelId: raw.graphifyLlm?.modelId,
      },
      providers: {
        // записи старого формата (с полями настроек) остаются как есть до
        // миграции: migrateProviderEntries (server-context) переносит значения
        // в .agents/providers/<id>/ и обрезает их здесь с сохранением state
        entries: (raw.providers?.entries ?? {}) as Record<string, ProviderVerification>,
        langgraphExport: raw.providers?.langgraphExport ?? null,
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

/** Обязательная рабочая папка: единственная зона записи (write mode); заполняется при загрузке state. */
export function mandatoryWorkspace(state: ConsoleState): string {
  return state.workspaces.mandatory;
}

/** Дополнительные папки - read mode: запись разрешена только в обязательной. */
export function isMandatoryWorkspace(state: ConsoleState, dir: string): boolean {
  return path.resolve(dir) === path.resolve(mandatoryWorkspace(state));
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
