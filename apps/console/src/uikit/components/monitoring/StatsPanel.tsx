"use client";
import { useCallback, useEffect, useState } from "react";
import { Chip, Footnote, Loading, Segmented } from "@/uikit";
import { durationLabel } from "@/lib/format";
import type { SeriesPoint } from "@/core/statsSeries";
import { UsageHeatmap } from "@/uikit/components/monitoring/UsageHeatmap";
import { UsageBarChart, type UsageBarMetric } from "@/uikit/components/monitoring/UsageBarChart";
import { StatsDrillModal, type DrillKind } from "@/uikit/components/monitoring/StatsDrillModal";
import { PLAN_PERIOD_LABEL, type SubscriptionPlan } from "@/core/pricingCatalog";
import type { BillingSelection } from "@/core/state";

type Row = Record<string, string | number | null>;

interface AgentPlaneStatus {
  installed: boolean;
  version: string | null;
  detail: string;
  projection?: {
    readiness?: unknown;
    taskCounts?: Record<string, number>;
    totalTasks?: number;
    activeTasks?: string[];
    error?: string | null;
  } | null;
}

interface StatsTotals {
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  knownCost?: number;
  estimatedCost?: number;
  costUsd?: number;
  pricedTokens?: number;
  totalTokens?: number;
  coverage?: number;
}

interface StatsData {
  runs?: Row[];
  runsByWorkflow?: Row[];
  attempts?: Row[];
  byRole?: Row[];
  byStep?: Row[];
  usage?: Row[];
  totals?: StatsTotals;
  /** Сессии рантаймов из индекса sessions.sqlite (тот же период). */
  sessions?: SessionsIndexSummary | null;
  agentplane?: AgentPlaneStatus | null;
}

/** Сводка индекса сессий за период (ответ /api/stats, блок sessions). */
interface SessionsIndexSummary {
  count: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  avgDurationMs: number;
  topProjects: { dir: string; sessions: number; tokens: number; costUsd: number }[];
  toolMix: { tool: string; calls: number }[];
  archetypes: { key: "quick" | "standard" | "deep" | "marathon"; count: number; tokens: number; costUsd: number }[];
}

/** Ответ /api/stats/series: дневной ряд расхода с разбивкой по моделям/рантаймам. */
interface SeriesData {
  metric: "tokens" | "cost";
  by: "model" | "runtime";
  points: SeriesPoint[];
  models: string[];
  bucket: "day" | "week";
}

/** Ответ /api/stats/tool-series: дневной ряд вызовов инструментов. */
interface ToolSeriesData {
  points: SeriesPoint[];
  models: string[];
  bucket: "day" | "week";
}

/** Открытая детализация: тип и ключ (день, модель, инструмент, проект). */
interface DrillState {
  kind: DrillKind;
  key: string;
}

const ARCHETYPE_LABEL: Record<string, string> = {
  quick: "быстрые <5 мин",
  standard: "стандартные <1 ч",
  deep: "глубокие <4 ч",
  marathon: "марафоны",
};

interface BillingEntry {
  runtimes?: Record<string, BillingSelection>;
  deposits?: Record<string, { amount: number; currency: string; at: string }[]>;
}

interface PricingSlices {
  plansByVendor: Record<string, SubscriptionPlan[]>;
}

/** Периоды статистики: 1 день, неделя, месяц, квартал, полгода, год, всё время. */
const PERIOD_OPTIONS = [
  { key: "1d", label: "1 д" },
  { key: "1w", label: "1 нед" },
  { key: "1m", label: "1 мес" },
  { key: "3m", label: "3 мес" },
  { key: "6m", label: "6 мес" },
  { key: "1y", label: "1 год" },
  { key: "all", label: "Всё" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  TODO: "к выполнению",
  DOING: "в работе",
  BLOCKED: "заблокировано",
  DONE: "завершено",
};

const fmtUsd = (value: number | undefined): string => (value === undefined ? "-" : `$${value.toFixed(2)}`);
const fmtTokens = (value: number | undefined): string => (value === undefined ? "-" : value.toLocaleString("ru-RU"));

/** Сводка оплаты: выбранные тарифы и Pay as You Go по рантаймам из settings.billing. */
function BillingSummary({ billing, plansByVendor }: { billing: BillingEntry | null; plansByVendor: PricingSlices["plansByVendor"] }) {
  const entries = Object.entries(billing?.runtimes ?? {}).filter(([, selection]) => selection.mode !== "none");
  if (entries.length === 0) {
    return <p className="mt-1 text-xs text-fg-muted">Подписки не выбраны. Выбор - вкладка «Подписки» на странице рантайма.</p>;
  }
  return (
    <ul className="mt-1 space-y-1">
      {entries.map(([runtime, selection]) => {
        const plan = selection.mode === "plan" ? (plansByVendor[runtime] ?? []).find((p) => p.id === selection.planId) : undefined;
        const depositKey = `runtime:${runtime}`;
        const deposited = Object.entries(billing?.deposits ?? {})
          .filter(([key]) => key === depositKey)
          .flatMap(([, list]) => list)
          .reduce((sum, d) => sum + d.amount, 0);
        return (
          <li key={runtime} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-[11px] text-fg">{runtime}</span>
            {plan ? (
              <Chip tone="sky" mono>
                {plan.name}: {plan.price} {plan.currency}/{PLAN_PERIOD_LABEL[plan.period]}
              </Chip>
            ) : (
              <Chip tone="muted" mono>
                Pay as You Go{deposited > 0 ? ` · пополнено ${deposited.toFixed(2)}` : ""}
              </Chip>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function StatsPanel() {
  const [data, setData] = useState<StatsData | null>(null);
  const [billing, setBilling] = useState<BillingEntry | null>(null);
  const [plansByVendor, setPlansByVendor] = useState<PricingSlices["plansByVendor"]>({});
  const [period, setPeriod] = useState<string>("all");
  const [view, setView] = useState<"tables" | "heatmap">("tables");
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<SeriesData | null>(null);
  const [seriesMetric, setSeriesMetric] = useState<"tokens" | "cost">("cost");
  const [seriesBy, setSeriesBy] = useState<"model" | "runtime">("model");
  const [toolSeries, setToolSeries] = useState<ToolSeriesData | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);

  const load = useCallback(async (activePeriod: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?period=${activePeriod}`, { cache: "no-store" });
      setData((await res.json()) as StatsData);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  useEffect(() => {
    void fetch(`/api/stats/series?metric=${seriesMetric}&by=${seriesBy}&period=${period}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: SeriesData) => setSeries(j.by === seriesBy ? j : null))
      .catch(() => setSeries(null));
  }, [period, seriesMetric, seriesBy]);

  useEffect(() => {
    void fetch(`/api/stats/tool-series?period=${period}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: ToolSeriesData) => setToolSeries(j.points ? j : null))
      .catch(() => setToolSeries(null));
  }, [period]);

  useEffect(() => {
    void fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBilling(j.billing ?? null))
      .catch(() => setBilling(null));
    void fetch("/api/pricing", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPlansByVendor(j.subscriptions?.vendors ?? {}))
      .catch(() => setPlansByVendor({}));
  }, []);

  const table = (title: string, rows: Row[]) => <section className="rounded-xl border border-line bg-surface p-3"><h2 className="mb-2 text-sm font-semibold">{title}</h2>{rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{Object.keys(rows[0]!).map((k) => <th key={k} className="border-b border-line p-2 text-fg-muted">{k}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j} className="border-b border-line/50 p-2">{String(v ?? "-")}</td>)}</tr>)}</tbody></table></div> : <p className="text-xs text-fg-faint">Данных пока нет</p>}</section>;
  const ap = data?.agentplane;
  const projection = ap?.projection;
  const taskCounts = projection?.taskCounts ?? {};
  const readiness = projection?.readiness as { ok?: boolean; initialized?: boolean } | null | undefined;
  const totals = data?.totals;
  const sessionsIndex = data?.sessions ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          options={[{ key: "tables", label: "Сводка" }, { key: "heatmap", label: "Heatmap" }]}
          value={view}
          onChange={setView}
          ariaLabel="вид статистики"
        />
        <Segmented options={PERIOD_OPTIONS.map((o) => ({ ...o }))} value={period} onChange={setPeriod} ariaLabel="период статистики" />
      </div>
      {view === "heatmap" ? <UsageHeatmap period={period} onDayDetail={(date) => setDrill({ kind: "day", key: date })} /> : null}
      {view === "tables" ? (
        loading && !data ? (
          <Loading>Статистика…</Loading>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-3">
                <h2 className="text-sm font-semibold">Токены и стоимость за период</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Chip tone="sky" mono>стоимость: {fmtUsd(totals?.costUsd)}</Chip>
                  {totals && (totals.knownCost ?? 0) > 0 ? <Chip tone="dim" mono>зафиксированная: {fmtUsd(totals.knownCost)}</Chip> : null}
                  {totals && (totals.estimatedCost ?? 0) > 0 ? <Chip tone="dim" mono>оценка по каталогу: {fmtUsd(totals.estimatedCost)}</Chip> : null}
                  <Chip tone="muted" mono>вход: {fmtTokens(totals?.inputTokens)}</Chip>
                  <Chip tone="muted" mono>выход: {fmtTokens(totals?.outputTokens)}</Chip>
                  <Chip tone="muted" mono>кеш: {fmtTokens(totals?.cacheTokens)}</Chip>
                  <Chip tone={totals && (totals.coverage ?? 1) < 0.5 ? "amber" : "emerald"} mono>покрытие ценой: {Math.round((totals?.coverage ?? 1) * 100)}%</Chip>
                </div>
                <Footnote className="mt-2">
                  Стоимость = зафиксированная (price card рантайма или конверт) плюс оценка по каталогу цен: официальная цена модели, при её отсутствии средняя по провайдерам.
                </Footnote>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3">
                <h2 className="text-sm font-semibold">Оплата рантаймов</h2>
                <BillingSummary billing={billing} plansByVendor={plansByVendor} />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Расход по дням</h2>
                <div className="flex items-center gap-2">
                  <Segmented
                    options={[{ key: "model", label: "Модели" }, { key: "runtime", label: "Рантаймы" }]}
                    value={seriesBy}
                    onChange={setSeriesBy}
                    ariaLabel="разбивка графика расхода"
                  />
                  <Segmented
                    options={[{ key: "cost", label: "Стоимость" }, { key: "tokens", label: "Токены" }]}
                    value={seriesMetric}
                    onChange={setSeriesMetric}
                    ariaLabel="метрика графика расхода"
                  />
                </div>
              </div>
              {series ? (
                <UsageBarChart
                  points={series.points}
                  models={series.models}
                  metric={series.metric as UsageBarMetric}
                  bucket={series.bucket}
                  onPointClick={(date) => setDrill({ kind: "day", key: date })}
                  onSeriesClick={(name) => setDrill({ kind: seriesBy === "runtime" ? "runtime" : "model", key: name })}
                />
              ) : (
                <Loading>График…</Loading>
              )}
              <Footnote className="mt-2">
                Источник - usage_receipts всех workspace: зафиксированная стоимость плюс оценка по каталогу цен. Клик по столбцу - детализация дня, по легенде - детализация модели или рантайма. Длинные периоды сворачиваются в недели.
              </Footnote>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Инструменты сессий по дням</h2>
              </div>
              {toolSeries ? (
                <UsageBarChart
                  points={toolSeries.points}
                  models={toolSeries.models}
                  metric="calls"
                  bucket={toolSeries.bucket}
                  onPointClick={(date) => setDrill({ kind: "day", key: date })}
                  onSeriesClick={(name) => setDrill({ kind: "tool", key: name })}
                />
              ) : (
                <Loading>График…</Loading>
              )}
              <Footnote className="mt-2">
                Вызовы инструментов в сессиях рантаймов (индекс сессий). Клик по легенде - сессии, где инструмент вызывался.
              </Footnote>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <h2 className="text-sm font-semibold">Сессии рантаймов</h2>
              {sessionsIndex && sessionsIndex.count > 0 ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip tone="sky" mono>сессий: {sessionsIndex.count}</Chip>
                    <Chip tone="muted" mono>токены: {fmtTokens(sessionsIndex.inputTokens + sessionsIndex.outputTokens + sessionsIndex.cacheTokens)}</Chip>
                    {sessionsIndex.costUsd > 0 ? <Chip tone="muted" mono>оценка: {fmtUsd(sessionsIndex.costUsd)}</Chip> : null}
                    <Chip tone="dim" mono>средняя длительность: {durationLabel(sessionsIndex.avgDurationMs)}</Chip>
                    {sessionsIndex.archetypes?.filter((bucket) => bucket.count > 0).map((bucket) => (
                      <Chip key={bucket.key} tone="dim" mono title={`${bucket.count} сесс., ${fmtTokens(bucket.tokens)} ток.`}>
                        {ARCHETYPE_LABEL[bucket.key]}: {bucket.count}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-xs font-semibold text-fg-muted">Топ проектов</h3>
                      <ul className="space-y-2">
                        {sessionsIndex.topProjects.slice(0, 5).map((project) => {
                          const maxProjectTokens = Math.max(...sessionsIndex.topProjects.map((entry) => entry.tokens), 1);
                          return (
                            <li key={project.dir}>
                              <button
                                type="button"
                                onClick={() => setDrill({ kind: "project", key: project.dir })}
                                className="w-full text-left"
                                title={`Сессии проекта ${project.dir}`}
                              >
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="truncate font-mono text-[11px] text-fg">{project.dir}</span>
                                  <span className="shrink-0 text-fg-faint">
                                    {project.sessions} сесс. · {fmtTokens(project.tokens)} ток.
                                    {project.costUsd > 0 ? ` · ${fmtUsd(project.costUsd)}` : ""}
                                  </span>
                                </div>
                                <div className="mt-1 h-1 rounded bg-page" aria-hidden>
                                  <div className="h-1 rounded bg-accent/50" style={{ width: `${Math.max((project.tokens / maxProjectTokens) * 100, 2)}%` }} />
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-semibold text-fg-muted">Инструменты сессий</h3>
                      {sessionsIndex.toolMix.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sessionsIndex.toolMix.slice(0, 12).map((tool) => (
                            <Chip key={tool.tool} tone="dim" mono>{tool.tool}: {tool.calls}</Chip>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-fg-faint">Вызовы инструментов для этого периода не записаны.</p>
                      )}
                    </div>
                  </div>
                  <Footnote className="mt-2">
                    Источник - индекс сессий (.agents/console/sessions.sqlite): транскрипты рантаймов разбираются инкрементально; стоимость - оценка по каталогу цен.
                  </Footnote>
                </>
              ) : (
                <p className="mt-1 text-xs text-fg-faint">
                  Сессии рантаймов ещё не собраны - откройте вкладку «Сессии» на странице рантайма или нажмите «Обновить» в списке сессий.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <h2 className="text-sm font-semibold">AgentPlane</h2>
              <p className="mt-1 text-xs text-fg-muted">
                {ap?.installed ? `Готов: ${ap.version}` : ap?.detail ?? "Не обнаружен"}
                {readiness?.initialized ? " · инициализирован" : ""}
              </p>
              {ap?.installed ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Chip tone="muted">всего: {projection?.totalTasks ?? 0}</Chip>
                  {Object.entries(taskCounts).map(([status, count]) => (
                    <Chip key={status} tone={status === "BLOCKED" ? "red" : status === "DOING" ? "sky" : status === "DONE" ? "emerald" : "dim"}>
                      {STATUS_LABEL[status] ?? status}: {count}
                    </Chip>
                  ))}
                  {projection?.error ? <span className="text-[11px] text-warning">{projection.error}</span> : null}
                  {!projection?.error && !projection ? (
                    <span className="text-[11px] text-fg-faint">задачи AgentPlane не инициализированы в workspace</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {table("Runs", data?.runs ?? [])}
              {table("По workflow", data?.runsByWorkflow ?? [])}
              {table("Роли", data?.byRole ?? [])}
            </div>
            {/* широкие таблицы - на полную ширину: 6+ колонок в узкой карточке обрезаются */}
            {table("Модели и стоимость", data?.usage ?? [])}
            {table("Attempts и токены", data?.attempts ?? [])}
            {table("Вызовы шагов (топ-30)", data?.byStep ?? [])}
            <p className="text-xs text-fg-faint">Таблицы за выбранный период. Подписки и Pay as You Go учитываются отдельно и не распределяются по задачам. Задачи AgentPlane - состояния из .agentplane активного workspace.</p>
          </>
        )
      ) : null}
      {drill ? (
        <StatsDrillModal
          open
          onClose={() => setDrill(null)}
          kind={drill.kind}
          keyValue={drill.key}
          period={period}
        />
      ) : null}
    </div>
  );
}
