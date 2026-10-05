"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Chip, EmptyState, IconButton, Loading, Segmented } from "@/uikit";

interface HeatmapToolCell {
  type: "runtime" | "provider" | "tool";
  id: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
  kinds: Record<string, number>;
}

interface HeatmapDay {
  date: string;
  total: number;
  byTool?: Record<string, HeatmapToolCell>;
}

export type HeatmapMetric = "tasks" | "sessions" | "tokens" | "cost";

const KIND_LABEL: Record<string, string> = {
  prompt: "промт",
  "openwiki-build": "openwiki",
  "graphify-build": "graphify",
  "graphify-wiki": "wiki",
};

const TYPE_LABEL: Record<HeatmapToolCell["type"], string> = {
  runtime: "рантайм",
  provider: "провайдер",
  tool: "инструмент",
};

/** Окна heatmap; "all" - максимальное окно 24 месяца. */
const PERIOD_OPTIONS = [
  { key: "1w", label: "1 нед" },
  { key: "1m", label: "1 мес" },
  { key: "3m", label: "3 мес" },
  { key: "6m", label: "6 мес" },
  { key: "1y", label: "1 год" },
  { key: "all", label: "Всё" },
] as const;

const PERIOD_DAYS: Record<string, number> = { "1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: 730 };

const METRIC_OPTIONS = [
  { key: "tasks", label: "Задачи" },
  { key: "sessions", label: "Сессии" },
  { key: "tokens", label: "Токены" },
  { key: "cost", label: "Стоимость" },
] as const;

const METRIC_UNIT: Record<HeatmapMetric, (value: number) => string> = {
  tasks: (v) => `запусков ${v}`,
  sessions: (v) => `сессий ${v}`,
  tokens: (v) => `токенов ${v.toLocaleString("ru-RU")}`,
  cost: (v) => `стоимость $${v.toFixed(2)}`,
};

const CELL = 13;
const GAP = 3;
const WEEKDAYS = ["пн", "", "ср", "", "пт", "", "вс"];

/** Уровень заливки 0-4 по отношению к пиковому дню окна. */
function level(total: number, max: number): number {
  if (total <= 0 || max <= 0) return 0;
  const ratio = total / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

const LEVEL_CLASS = ["bg-page border-line/60", "bg-accent/20 border-accent/20", "bg-accent/40 border-accent/30", "bg-accent/60 border-accent/40", "bg-accent border-accent"];

/** "2026-10-02" -> локальная полночь (Date парсит такую строку как UTC). */
function parseDay(date: string): Date {
  return new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function dayCellClass(total: number, max: number, selected: boolean): string {
  const base = "rounded-[3px] border transition-colors";
  if (selected) return `${base} border-fg ring-1 ring-fg ${total > 0 ? "bg-accent" : "bg-raised"}`;
  return `${base} ${LEVEL_CLASS[level(total, max)]}`;
}

export function UsageHeatmap({ period, onDayDetail }: { period?: string; onDayDetail?: (date: string) => void }) {
  const [internalPeriod, setInternalPeriod] = useState<string>("6m");
  const [metric, setMetric] = useState<HeatmapMetric>("tasks");
  const [days, setDays] = useState<HeatmapDay[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const effectivePeriod = period ?? internalPeriod;
  const windowDays = PERIOD_DAYS[effectivePeriod] ?? 182;

  const load = useCallback((activePeriod: string, activeMetric: HeatmapMetric) => {
    void fetch(`/api/stats/heatmap?metric=${activeMetric}&period=${activePeriod}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { days?: HeatmapDay[] }) => setDays(j.days ?? []))
      .catch(() => setDays([]));
  }, []);

  useEffect(() => {
    load(effectivePeriod, metric);
  }, [load, effectivePeriod, metric]);

  const grid = useMemo(() => {
    if (!days) return null;
    const byDate = new Map(days.map((day) => [day.date, day]));
    const max = days.reduce((peak, day) => Math.max(peak, day.total), 0);
    const today = new Date();
    const start = new Date(today.getTime() - windowDays * 86_400_000);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // назад к понедельнику
    const weeks: Array<Array<{ date: string; day: HeatmapDay | null }>> = [];
    for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (weeks.at(-1)?.length === 7 || weeks.length === 0) weeks.push([]);
      weeks.at(-1)!.push({ date, day: byDate.get(date) ?? null });
    }
    return { weeks, max };
  }, [days, windowDays]);

  const selectedDay = selected ? days?.find((day) => day.date === selected) ?? null : null;

  if (days === null) return <Loading />;
  if (grid === null || grid.weeks.length === 0 || days.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Использование harness</h2>
          <div className="flex items-center gap-2">
            <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} ariaLabel="метрика heatmap" />
            {!period ? <Segmented options={PERIOD_OPTIONS} value={internalPeriod} onChange={setInternalPeriod} ariaLabel="окно heatmap" /> : null}
          </div>
        </div>
        <EmptyState size="sm">Данных за этот период нет.</EmptyState>
      </section>
    );
  }

  const unit = METRIC_UNIT[metric];

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Использование harness</h2>
          <p className="mt-0.5 text-[11px] text-fg-faint">
            {metric === "tasks"
              ? "Один отсчёт - одна задача: промт, запрос провайдеру или сборка. Нажмите день для детализации по инструментам."
              : metric === "sessions"
                ? "Сессии рантаймов по дню старта (индекс сессий sessions.sqlite)."
                : metric === "tokens"
                  ? "Сумма токенов usage за день по всем workspace (usage_receipts)."
                  : "Стоимость usage за день: известная стоимость или оценка по каталогу цен (официальная цена модели, иначе средняя)."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} ariaLabel="метрика heatmap" />
          {!period ? <Segmented options={PERIOD_OPTIONS} value={internalPeriod} onChange={setInternalPeriod} ariaLabel="окно heatmap" /> : null}
          <IconButton icon={RefreshCw} label="Обновить heatmap" onClick={() => load(effectivePeriod, metric)} />
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col">
          {/* подписи месяцев над колонками недель */}
          <div className="flex" style={{ marginLeft: 28 }}>
            {grid.weeks.map((week, index) => {
              const month = Number(week[0]!.date.slice(5, 7));
              const prev = index > 0 ? Number(grid.weeks[index - 1]![0]!.date.slice(5, 7)) : null;
              const show = prev === null || month !== prev;
              return (
                <div key={week[0]!.date} className="relative text-[10px] text-fg-faint" style={{ width: CELL + GAP }}>
                  {show ? (
                    <span className="absolute left-0 top-0 whitespace-nowrap">
                      {parseDay(week[0]!.date).toLocaleDateString("ru-RU", { month: "short" })}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex">
            <div className="flex flex-col" style={{ width: 28, gap: GAP, paddingTop: 2 }}>
              {WEEKDAYS.map((label, index) => (
                <div key={index} className="text-[10px] leading-none text-fg-faint" style={{ height: CELL, lineHeight: `${CELL}px` }}>{label}</div>
              ))}
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {grid.weeks.map((week) => (
                <div key={week[0]!.date} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((cell) => (
                    <button
                      key={cell.date}
                      type="button"
                      title={`${cell.date}: ${unit(cell.day?.total ?? 0)}`}
                      aria-label={`${cell.date}: ${unit(cell.day?.total ?? 0)}`}
                      onClick={() => setSelected(cell.day && selected !== cell.date ? cell.date : null)}
                      className={dayCellClass(cell.day?.total ?? 0, grid.max, selected === cell.date)}
                      style={{ width: CELL, height: CELL }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-fg-faint">
        меньше
        {LEVEL_CLASS.map((cls) => <span key={cls} className={`inline-block h-[11px] w-[11px] rounded-[3px] border ${cls}`} />)}
        больше
      </div>

      {selectedDay ? (
        <div className="mt-3 border-t border-line/60 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">
              {selectedDay.date} · {unit(selectedDay.total)}
            </h3>
            {onDayDetail ? (
              <button
                type="button"
                onClick={() => onDayDetail(selectedDay.date)}
                className="rounded border border-line px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                Детализация дня
              </button>
            ) : null}
          </div>
          {selectedDay.byTool ? (
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="border-b border-line p-2 text-fg-muted">Инструмент</th>
                  <th className="border-b border-line p-2 text-fg-muted">Тип</th>
                  <th className="border-b border-line p-2 text-fg-muted">Запуски</th>
                  <th className="border-b border-line p-2 text-fg-muted">Завершено</th>
                  <th className="border-b border-line p-2 text-fg-muted">Ошибки</th>
                  <th className="border-b border-line p-2 text-fg-muted">В работе</th>
                  <th className="border-b border-line p-2 text-fg-muted">Типы задач</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(selectedDay.byTool).map(([key, cell]) => (
                  <tr key={key}>
                    <td className="border-b border-line/50 p-2 font-mono">{cell.id}</td>
                    <td className="border-b border-line/50 p-2 text-fg-muted">{TYPE_LABEL[cell.type]}</td>
                    <td className="border-b border-line/50 p-2">{cell.total}</td>
                    <td className="border-b border-line/50 p-2">{cell.completed}</td>
                    <td className={`border-b border-line/50 p-2 ${cell.failed ? "text-danger" : ""}`}>{cell.failed}</td>
                    <td className="border-b border-line/50 p-2">{cell.running}</td>
                    <td className="border-b border-line/50 p-2">
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(cell.kinds).map(([kind, count]) => (
                          <Chip key={kind} tone="dim">{KIND_LABEL[kind] ?? kind}: {count}</Chip>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
