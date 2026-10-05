"use client";

import type { SeriesPoint } from "@/core/statsSeries";
import { formatTokens } from "@/lib/format";
import { EmptyState } from "@/uikit";

/**
 * Stack-бар-чарт дневного расхода по моделям (самодельный, в стиле
 * UsageHeatmap): столбец на день (или неделю), сегменты - модели,
 * отсортированные по суммарному значению; "прочее" - верхний серый сегмент.
 * Подписи месяцев - на первом столбце месяца; детали столбца - в title.
 * Необязательные клики: onPointClick - столбец (детализация дня),
 * onSeriesClick - элемент легенды (детализация модели/инструмента).
 */

const SWATCH = ["bg-accent/95", "bg-accent/70", "bg-accent/50", "bg-accent/35", "bg-accent/20", "bg-accent/10", "bg-accent/10", "bg-accent/10"];
const OTHER_SWATCH = "bg-fg-muted/40";
const OTHER_KEY = "прочее";

export type UsageBarMetric = "tokens" | "cost" | "calls";

function valueLabel(metric: UsageBarMetric, value: number): string {
  if (metric === "cost") return `$${value.toFixed(2)}`;
  if (metric === "calls") return `${formatTokens(value)} выз.`;
  return `${formatTokens(value)} ток.`;
}

function tooltip(metric: UsageBarMetric, point: SeriesPoint): string {
  const head = `${point.date}: ${valueLabel(metric, point.total)}`;
  const entries = Object.entries(point.parts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const rest = Object.keys(point.parts).length - entries.length;
  const lines = entries.map(([model, value]) => `  ${model}: ${valueLabel(metric, value)}`);
  if (rest > 0) lines.push(`  …и ещё ${rest}`);
  return [head, ...lines].join("\n");
}

/** Подпись месяца для дня/недели "YYYY-MM-DD": короткое имя месяца. */
function monthLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" });
}

export function UsageBarChart({
  points,
  models,
  metric,
  bucket,
  onPointClick,
  onSeriesClick,
}: {
  points: SeriesPoint[];
  models: string[];
  metric: UsageBarMetric;
  bucket: "day" | "week";
  /** Клик по столбцу - детализация дня. */
  onPointClick?: (date: string) => void;
  /** Клик по элементу легенды - детализация модели/инструмента. */
  onSeriesClick?: (name: string) => void;
}) {
  if (points.length === 0) {
    return <EmptyState size="sm">Данных за этот период нет.</EmptyState>;
  }
  const max = points.reduce((peak, point) => Math.max(peak, point.total), 0);
  const stacking = [...models, OTHER_KEY];
  const swatchOf = (model: string): string => (model === OTHER_KEY ? OTHER_SWATCH : SWATCH[models.indexOf(model)] ?? OTHER_SWATCH);

  return (
    <div>
      <div className="relative h-36">
        <div className="flex h-full items-end gap-px">
          {points.map((point) => (
            <div
              key={point.date}
              className={`flex h-full min-w-[2px] flex-1 flex-col justify-end gap-px ${onPointClick ? "cursor-pointer" : ""}`}
              title={tooltip(metric, point)}
              aria-label={`${point.date}: ${valueLabel(metric, point.total)}`}
              onClick={onPointClick ? () => onPointClick(point.date) : undefined}
              role={onPointClick ? "button" : undefined}
            >
              {/* сегменты сверху вниз: прочее, затем модели по убыванию доли */}
              {[...stacking].reverse().map((model) => {
                const value = point.parts[model] ?? 0;
                if (value <= 0 || max <= 0) return null;
                return (
                  <div
                    key={model}
                    className={`${swatchOf(model)} min-h-[2px] w-full`}
                    style={{ height: `${Math.max((value / max) * 100, 1)}%` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-px">
        {points.map((point, index) => {
          const prev = index > 0 ? points[index - 1]!.date : null;
          const show = prev === null || point.date.slice(5, 7) !== prev.slice(5, 7);
          return (
            <div key={point.date} className="relative min-w-[2px] flex-1">
              {show ? <span className="absolute left-0 whitespace-nowrap text-[10px] text-fg-faint">{monthLabel(point.date)}</span> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-fg-faint">
        <span>{bucket === "week" ? "по неделям" : "по дням"}</span>
        {models.map((model) =>
          onSeriesClick ? (
            <button key={model} type="button" onClick={() => onSeriesClick(model)} className="flex items-center gap-1 transition-colors hover:text-fg">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${swatchOf(model)}`} aria-hidden />
              {model}
            </button>
          ) : (
            <span key={model} className="flex items-center gap-1">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${swatchOf(model)}`} aria-hidden />
              {model}
            </span>
          ),
        )}
        {points.some((point) => (point.parts[OTHER_KEY] ?? 0) > 0) ? (
          <span className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${OTHER_SWATCH}`} aria-hidden />
            {OTHER_KEY}
          </span>
        ) : null}
      </div>
    </div>
  );
}
