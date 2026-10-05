import { homedir } from "node:os";
import { effectiveModelPrice } from "./pricingCatalog";
import { readCatalog } from "./pricingCatalogServer";
import {
  isActiveProvider,
  parseTaskProviderId,
  providerBaseUrlError,
  providerPresetById,
} from "./providers";
import { executeProviderRequest } from "./providerRun";
import { resolveProviderToken } from "./providerAuth";
import { readProviderEntry } from "./providerSettings";
import { ensureSessionsIndex } from "./sessionsIndex/collect";
import { SessionIndexStore } from "./sessionsIndex/store";
import { detectToolCli, toolById } from "./tools";
import {
  normalizeOptimizationReport,
  resolveDefaultProvider,
  resolveOptimizationExecutor,
  workspaceDirs,
  type ConsoleState,
  type OptimizationKind,
  type OptimizationRecommendation,
  type OptimizationReport,
} from "./state";
import type { ProbeContext } from "./types";
import { usageDailyAcrossWorkspaces, type UsageDailyRow } from "./workflows/storage";
import { fsSignals } from "@/lib/signals/fs";
import { ADAPTERS } from "@/runtimes";

/**
 * Отчёты оптимизации (вкладка "Настройки → Оптимизация"). Сводка статистики
 * собирается из существующих агрегатов консоли (usage_receipts, индекс сессий,
 * каталог цен) и отправляется провайдеру синхронным запросом; рекомендации
 * парсятся из JSON-ответа. Запуск оптимизации переиспользует исполнителей
 * задачи "Оптимизация" (core/prompts.ts и core/providerRun.ts).
 */

/** Окно анализа отчёта. */
export const REPORT_PERIOD_DAYS = 30;

/** Ошибки генерации отчёта: текст для статус-строки интерфейса. */
export class OptimizationError extends Error {}

/** Готовность отчётов: Claude Code для Claude Insights, инструмент CodeBurn для CodeBurn. */
export interface OptimizationReadiness {
  /** Рантайм claude установлен на этой машине (детект адаптера, маркер ~/.claude). */
  claudeInstalled: boolean;
  /** CLI codeburn в PATH. */
  codeburnInstalled: boolean;
  /** Инструмент codeburn включён в консоли (запись tools.installed). */
  codeburnEnabled: boolean;
}

/** Готовность отчётов по виду: Claude Code - детект адаптера, CodeBurn - CLI + запись консоли. */
export async function optimizationReadiness(repoRoot: string, state: ConsoleState): Promise<OptimizationReadiness> {
  const ctx: ProbeContext = { repoRoot, home: homedir(), fs: fsSignals, workspaces: workspaceDirs(state) };
  let claudeInstalled = true;
  try {
    claudeInstalled = ADAPTERS.claude?.isInstalled ? await ADAPTERS.claude.isInstalled(ctx) : true;
  } catch {
    claudeInstalled = true; // не смогли определить - не считаем отсутствующим
  }
  const def = toolById("codeburn");
  return {
    claudeInstalled,
    codeburnInstalled: def ? detectToolCli(def.bin).installed : false,
    codeburnEnabled: state.tools.installed.codeburn?.enabled === true,
  };
}

/** Причина, по которой отчёт вида kind недоступен; null - доступен. */
export async function readinessError(repoRoot: string, state: ConsoleState, kind: OptimizationKind): Promise<string | null> {
  const readiness = await optimizationReadiness(repoRoot, state);
  if (kind === "claudeInsights" && !readiness.claudeInstalled) {
    return "Claude Code не установлен на этой машине - установите Claude Code и выполните вход; отчёт Claude Insights анализирует его сессии";
  }
  if (kind === "codeburn" && !readiness.codeburnInstalled) {
    return "CodeBurn не установлен - установите инструмент в разделе \"Настройки → Инструменты\"";
  }
  if (kind === "codeburn" && !readiness.codeburnEnabled) {
    return "CodeBurn не активирован - включите инструмент в разделе \"Настройки → Инструменты\"";
  }
  return null;
}

const r4 = (value: number): number => Math.round(value * 10000) / 10000;

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  knownCost: number;
  estimatedCost: number;
}

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, knownCost: 0, estimatedCost: 0 };
}

function addRow(totals: UsageTotals, row: UsageDailyRow, catalog: Awaited<ReturnType<typeof readCatalog>>): void {
  totals.inputTokens += row.inputTokens;
  totals.outputTokens += row.outputTokens;
  totals.cacheTokens += row.cacheTokens;
  totals.knownCost += row.knownCost;
  if (row.knownCost <= 0) {
    const price = effectiveModelPrice(catalog, row.model ?? "");
    if (price.origin !== "none") {
      totals.estimatedCost += (row.inputTokens * price.inputPerMtok + row.outputTokens * price.outputPerMtok + row.cacheTokens * (price.cacheReadPerMtok ?? 0)) / 1e6;
    }
  }
}

function withCost(totals: UsageTotals) {
  return {
    inputTokens: Math.round(totals.inputTokens),
    outputTokens: Math.round(totals.outputTokens),
    cacheTokens: Math.round(totals.cacheTokens),
    costUsd: r4(totals.knownCost + totals.estimatedCost),
  };
}

/** Сводка по Claude Code: сессии из индекса (за окно) и usage-строки рантайма claude. */
function claudeInsightsSummary(repoRoot: string, sinceIso: string, catalog: Awaited<ReturnType<typeof readCatalog>>) {
  let index: SessionIndexStore | null = null;
  let claudeSessions: ReturnType<SessionIndexStore["listSessions"]> = [];
  let overall: ReturnType<SessionIndexStore["summary"]> | null = null;
  try {
    index = new SessionIndexStore(repoRoot);
    claudeSessions = index.listSessions({ runtime: "claude", since: sinceIso, limit: 1000 });
    overall = index.summary(sinceIso);
  } catch {
    claudeSessions = [];
  } finally {
    index?.close();
  }

  const models = new Map<string, number>();
  const projects = new Map<string, { sessions: number; tokens: number; costUsd: number }>();
  let turns = 0;
  let toolCalls = 0;
  let durationMs = 0;
  let claudeTokens = { input: 0, output: 0, cache: 0 };
  let claudeCost = 0;
  for (const row of claudeSessions) {
    turns += row.turns;
    toolCalls += row.toolCount;
    durationMs += row.durationMs;
    claudeTokens.input += row.inputTokens;
    claudeTokens.output += row.outputTokens;
    claudeTokens.cache += row.cacheTokens;
    claudeCost += row.costUsd;
    for (const model of row.models) models.set(model, (models.get(model) ?? 0) + 1);
    const dir = row.workspaceDir ?? row.projectDir ?? "(без папки)";
    const entry = projects.get(dir) ?? { sessions: 0, tokens: 0, costUsd: 0 };
    entry.sessions += 1;
    entry.tokens += row.inputTokens + row.outputTokens + row.cacheTokens;
    entry.costUsd += row.costUsd;
    projects.set(dir, entry);
  }

  // usage-строки рантайма claude из всех workspace-хранилищ (dimension="runtime")
  const usageRows = usageDailyAcrossWorkspaces(repoRoot, sinceIso, "runtime").filter((row) => row.model === "claude");
  const claudeUsage = emptyTotals();
  const byDay = new Map<string, number>();
  for (const row of usageRows) {
    addRow(claudeUsage, row, catalog);
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.inputTokens + row.outputTokens + row.cacheTokens);
  }

  return {
    period: { days: REPORT_PERIOD_DAYS, since: sinceIso },
    claude: {
      sessions: claudeSessions.length,
      turns,
      avgTurnsPerSession: claudeSessions.length ? Math.round(turns / claudeSessions.length) : 0,
      toolCalls,
      avgDurationMin: claudeSessions.length ? Math.round(durationMs / claudeSessions.length / 60000) : 0,
      tokens: {
        input: Math.round(claudeTokens.input),
        output: Math.round(claudeTokens.output),
        cache: Math.round(claudeTokens.cache),
      },
      costUsd: r4(claudeCost),
      usageReceipts: withCost(claudeUsage),
      models: [...models.entries()].map(([model, sessions]) => ({ model, sessions })).sort((a, b) => b.sessions - a.sessions).slice(0, 8),
      topProjects: [...projects.entries()]
        .map(([dir, value]) => ({ dir, sessions: value.sessions, tokens: value.tokens, costUsd: r4(value.costUsd) }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5),
      tokensByDay: [...byDay.entries()].map(([day, tokens]) => ({ day, tokens })).sort((a, b) => a.day.localeCompare(b.day)),
    },
    allRuntimes: {
      sessions: overall?.count ?? 0,
      tokens: Math.round((overall?.inputTokens ?? 0) + (overall?.outputTokens ?? 0) + (overall?.cacheTokens ?? 0)),
      costUsd: overall?.costUsd ?? 0,
      toolMix: (overall?.toolMix ?? []).slice(0, 10),
    },
  };
}

/** Сводка расхода токенов и стоимости по всем рантаймам и провайдерам. */
function codeBurnSummary(repoRoot: string, sinceIso: string, catalog: Awaited<ReturnType<typeof readCatalog>>) {
  const byModelRows = usageDailyAcrossWorkspaces(repoRoot, sinceIso, "model");
  const byRuntimeRows = usageDailyAcrossWorkspaces(repoRoot, sinceIso, "runtime");

  const aggregate = (rows: ReturnType<typeof usageDailyAcrossWorkspaces>) => {
    const groups = new Map<string, UsageTotals>();
    for (const row of rows) {
      const key = row.model || "(неизвестно)";
      const entry = groups.get(key) ?? emptyTotals();
      addRow(entry, row, catalog);
      groups.set(key, entry);
    }
    return [...groups.entries()]
      .map(([key, totals]) => ({ key, ...withCost(totals) }))
      .sort((a, b) => b.costUsd + b.inputTokens + b.outputTokens - (a.costUsd + a.inputTokens + a.outputTokens));
  };

  // тренд: сравнение сумм токенов за первую и вторую половины окна
  const startMs = Date.parse(sinceIso);
  const middleIso = new Date(startMs + (Date.now() - startMs) / 2).toISOString();
  const sumRange = (rows: ReturnType<typeof usageDailyAcrossWorkspaces>, from: string, to: string) =>
    rows.filter((row) => row.day >= from.slice(0, 10) && row.day < to.slice(0, 10)).reduce((sum, row) => sum + row.inputTokens + row.outputTokens + row.cacheTokens, 0);

  let index: SessionIndexStore | null = null;
  let sessions: ReturnType<SessionIndexStore["summary"]> | null = null;
  try {
    index = new SessionIndexStore(repoRoot);
    sessions = index.summary(sinceIso);
  } catch {
    sessions = null;
  } finally {
    index?.close();
  }

  const totals = emptyTotals();
  for (const row of byModelRows) addRow(totals, row, catalog);

  return {
    period: { days: REPORT_PERIOD_DAYS, since: sinceIso },
    totals: { ...withCost(totals), sessions: sessions?.count ?? 0 },
    byModel: aggregate(byModelRows).slice(0, 12),
    byRuntime: aggregate(byRuntimeRows).slice(0, 10),
    trend: {
      firstHalfTokens: Math.round(sumRange(byModelRows, sinceIso, middleIso)),
      secondHalfTokens: Math.round(sumRange(byModelRows, middleIso, new Date().toISOString())),
    },
    cacheHitRate:
      totals.inputTokens + totals.cacheTokens > 0
        ? r4(totals.cacheTokens / (totals.inputTokens + totals.cacheTokens))
        : null,
    sessions: sessions
      ? {
          count: sessions.count,
          avgDurationMs: sessions.avgDurationMs,
          archetypes: sessions.archetypes,
          topProjects: sessions.topProjects.slice(0, 5),
        }
      : null,
  };
}

/** Компактная JSON-сводка отчёта без текстов сообщений (для промпта анализа). */
export async function buildDataSummary(repoRoot: string, kind: OptimizationKind): Promise<Record<string, unknown>> {
  const sinceIso = new Date(Date.now() - REPORT_PERIOD_DAYS * 86_400_000).toISOString();
  // сбор индекса - без гарантии: сводка строится и на пустом индексе
  void ensureSessionsIndex(repoRoot).catch(() => 0);
  const catalog = await readCatalog(repoRoot);
  return kind === "claudeInsights" ? claudeInsightsSummary(repoRoot, sinceIso, catalog) : codeBurnSummary(repoRoot, sinceIso, catalog);
}

const KIND_FOCUS: Record<OptimizationKind, string> = {
  claudeInsights:
    "фокус - оптимизация работы с Claude Code: контекст и длина сессий, выбор моделей, повторяющиеся ручные операции, пригодное для автоматизации (навыки, хуки, команды)",
  codeburn:
    "фокус - снижение расхода токенов и стоимости: дорогие модели на простых задачах, низкий hit-rate кеша, рост расхода, замена ручных проходов инструментами экономии контекста",
};

/** Промпт анализа: сводка на входе, строгий JSON рекомендаций на выходе. */
export function buildReportPrompt(kind: OptimizationKind, summary: Record<string, unknown>): string {
  return [
    "Ты - аналитик использования AI-кодинговых агентов. Ниже - агрегированная статистика консоли за последние "
      + REPORT_PERIOD_DAYS
      + " дней (без текстов сообщений).",
    `Задача: составь рекомендации по оптимизации. ${KIND_FOCUS[kind]}.`,
    "Опирайся на числа из статистики; каждая рекомендация - конкретное действие, которое можно выполнить в этом репозитории.",
    "",
    "Верни СТРОГО один JSON-объект без пояснений и markdown-обёртки, формат:",
    '{"recommendations":[{"id":"короткий-латинский-идентификатор","title":"краткое действие","detail":"что сделать и на каких числах основано","impact":"high|medium|low"}]}',
    "Требования: 5-10 рекомендаций, тексты на русском языке, уникальные id, сначала рекомендации с impact=high.",
    "",
    "Статистика (JSON):",
    JSON.stringify(summary),
  ].join("\n");
}

/** Разбор рекомендаций из ответа модели: весь текст или первый JSON-объект. */
function parseRecommendations(text: string): { recommendations: OptimizationRecommendation[] } | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { recommendations?: unknown };
      if (parsed && Array.isArray(parsed.recommendations)) {
        const report = normalizeOptimizationReport({ generatedAt: new Date().toISOString(), recommendations: parsed.recommendations });
        if (report) return { recommendations: report.recommendations };
      }
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

/** Параметры провайдера для синхронного запроса отчёта; строка ошибки при недоступности. */
async function resolveReportProvider(
  repoRoot: string,
  state: ConsoleState,
  kind: OptimizationKind,
): Promise<{ preset: NonNullable<ReturnType<typeof providerPresetById>>; providerId: string; model: string; entry: Awaited<ReturnType<typeof readProviderEntry>>; baseUrl: string; prompt: string } | string> {
  const executor = resolveOptimizationExecutor(state);
  // отчёт требует синхронный ответ: провайдер из исполнителя задачи, иначе провайдер по умолчанию (Ollama)
  const providerId = parseTaskProviderId(executor) ?? resolveDefaultProvider(state);
  const preset = providerPresetById(providerId);
  if (!preset) return `провайдер не найден в реестре: ${providerId}`;
  const entry = await readProviderEntry(repoRoot, preset, state.providers?.entries?.[providerId] ?? null);
  if (!isActiveProvider(preset, entry)) {
    return `провайдер ${preset.label} не активен - заполните поля и пройдите проверку на вкладке "Провайдеры"`;
  }
  const model = entry.models.standard.trim();
  if (!model) return `у провайдера ${preset.label} не задана модель standard`;
  const baseUrlError = providerBaseUrlError(entry.baseUrl, preset.kind);
  if (baseUrlError) return baseUrlError;
  const precheck = await resolveProviderToken(preset, entry);
  if (!precheck.ok) return precheck.error;
  const summary = await buildDataSummary(repoRoot, kind);
  return { preset, providerId, model, entry, baseUrl: entry.baseUrl.trim(), prompt: buildReportPrompt(kind, summary) };
}

/**
 * Сформировать отчёт оптимизации: сводка статистики -> провайдер -> JSON
 * рекомендаций. Бросает OptimizationError с текстом причины.
 */
export async function generateReport(repoRoot: string, state: ConsoleState, kind: OptimizationKind): Promise<OptimizationReport> {
  const notReady = await readinessError(repoRoot, state, kind);
  if (notReady) throw new OptimizationError(notReady);
  const resolved = await resolveReportProvider(repoRoot, state, kind);
  if (typeof resolved === "string") throw new OptimizationError(resolved);
  const { preset, providerId, model, entry, baseUrl, prompt } = resolved;
  const result = await executeProviderRequest({ preset, providerId, model, prompt, entry, baseUrl });
  if (!result.ok) throw new OptimizationError(`провайдер ${preset.label}: ${result.error}`);
  const parsed = parseRecommendations(result.text);
  if (!parsed) throw new OptimizationError("модель вернула ответ не в формате JSON с полем recommendations");
  return { generatedAt: new Date().toISOString(), recommendations: parsed.recommendations };
}

/** Промпт запуска оптимизации: выбранные рекомендации как задача исполнителю. */
export function buildOptimizePrompt(kind: OptimizationKind, recommendations: OptimizationRecommendation[]): string {
  const header =
    kind === "claudeInsights"
      ? "Примени в этом репозитории выбранные оптимизации работы с Claude Code."
      : "Примени в этом репозитории выбранные оптимизации расхода токенов и стоимости.";
  const list = recommendations.map((rec, index) => `${index + 1}. ${rec.title}\n   ${rec.detail}`).join("\n");
  return [
    header,
    "Работай по правилам AGENTS.md репозитория; применяй только то, что применимо к этому проекту.",
    "После изменений запусти проверку из раздела \"Верификация\" и исправь ошибки.",
    "",
    "Выбранные оптимизации:",
    list,
  ].join("\n");
}
