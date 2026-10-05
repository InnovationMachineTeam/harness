/**
 * Дневные ряды usage для графика расхода (карточка "Расход по дням"):
 * строки day x model из usage_receipts всех workspace-хранилищ сворачиваются
 * в точки ряда с разбивкой по моделям (топ-N, остаток - "прочее").
 * Окна длиннее 120 дней сворачиваются в недельные корзины (начало - понедельник).
 */

export interface SeriesRow {
  day: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  knownCost: number;
}

export interface SeriesPoint {
  date: string;
  total: number;
  /** Значение по модели (метрика); ключ "прочее" - модели вне топ-N. */
  parts: Record<string, number>;
}

export type SeriesMetric = "tokens" | "cost";

/** Окна ряда в днях; "all" - без ограничения (0). */
export const SERIES_PERIOD_DAYS: Record<string, number> = { "1d": 1, "1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365 };

const NO_MODEL = "(без модели)";
const OTHER = "прочее";
/** Порог дневного ряда: длиннее - недельные корзины. */
const WEEK_BUCKET_SPAN_MS = 120 * 86_400_000;

type PriceFn = (model: string, inputTokens: number, outputTokens: number, cacheTokens: number) => number;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Понедельник недели дня "YYYY-MM-DD" (UTC-арифметика, дни приходят из substr ISO-времени). */
export function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const shift = (date.getUTCDay() + 6) % 7;
  return utcDay(new Date(date.getTime() - shift * 86_400_000));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Ряд для графика: точки по дням (или неделям при длинном окне), разбивка
 * по топ-N моделей, остаток - "прочее"; total точки - сумма частей.
 * options.value переопределяет значение строки (по умолчанию - токены или
 * стоимость метрики); используется для рядов вызовов инструментов.
 */
export function buildSeries(
  rows: SeriesRow[],
  options: { metric: SeriesMetric; price: PriceFn; topN?: number; value?: (row: SeriesRow) => number },
): { points: SeriesPoint[]; models: string[]; bucket: "day" | "week" } {
  const topN = options.topN ?? 6;
  const value = (row: SeriesRow): number => {
    if (options.value) return options.value(row);
    if (options.metric === "cost") {
      return row.knownCost > 0 ? row.knownCost : options.price(row.model ?? NO_MODEL, row.inputTokens, row.outputTokens, row.cacheTokens);
    }
    return row.inputTokens + row.outputTokens + row.cacheTokens;
  };

  const days = [...new Set(rows.map((row) => row.day).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort();
  if (days.length === 0) return { points: [], models: [], bucket: "day" };
  const span = new Date(`${days[days.length - 1]}T00:00:00Z`).getTime() - new Date(`${days[0]}T00:00:00Z`).getTime();
  const bucket: "day" | "week" = span > WEEK_BUCKET_SPAN_MS ? "week" : "day";
  const keyOf = (day: string): string => (bucket === "week" ? weekStart(day) : day);

  const perModel = new Map<string, number>();
  const buckets = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const amount = value(row);
    if (amount <= 0) continue;
    const model = row.model?.trim() || NO_MODEL;
    perModel.set(model, (perModel.get(model) ?? 0) + amount);
    const date = keyOf(row.day);
    const dayParts = buckets.get(date) ?? new Map<string, number>();
    dayParts.set(model, (dayParts.get(model) ?? 0) + amount);
    buckets.set(date, dayParts);
  }

  const models = [...perModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([model]) => model);
  const topSet = new Set(models);
  const points = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dayParts]) => {
      const parts: Record<string, number> = {};
      let total = 0;
      for (const model of models) {
        const amount = dayParts.get(model) ?? 0;
        if (amount > 0) {
          parts[model] = options.metric === "cost" ? round4(amount) : Math.round(amount);
          total += amount;
        }
      }
      let other = 0;
      for (const [model, amount] of dayParts) {
        if (!topSet.has(model)) other += amount;
      }
      if (other > 0) {
        parts[OTHER] = options.metric === "cost" ? round4(other) : Math.round(other);
        total += other;
      }
      return { date, total: options.metric === "cost" ? round4(total) : Math.round(total), parts };
    });
  return { points, models, bucket };
}
