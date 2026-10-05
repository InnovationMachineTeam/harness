import { describe, expect, test } from "bun:test";
import { buildSeries, weekStart, type SeriesRow } from "@/core/statsSeries";

const price = (model: string, input: number, output: number, cache: number): number =>
  ((model === "expensive" ? 10 : 1) * (input + output + cache)) / 1e6;

function row(day: string, model: string | null, input: number, output = 0, cache = 0, knownCost = 0): SeriesRow {
  return { day, model, inputTokens: input, outputTokens: output, cacheTokens: cache, knownCost };
}

describe("buildSeries", () => {
  test("дневной ряд: разбивка по моделям, топ-N и прочее", () => {
    const rows = [
      row("2026-10-01", "a", 100),
      row("2026-10-01", "b", 50),
      row("2026-10-01", "c", 25),
      row("2026-10-02", "a", 10, 5, 5),
      row("2026-10-02", null, 7),
    ];
    const series = buildSeries(rows, { metric: "tokens", price, topN: 2 });
    expect(series.bucket).toBe("day");
    // модели по суммарному значению: a (120), b (50); c и (без модели) - прочее
    expect(series.models).toEqual(["a", "b"]);
    expect(series.points).toHaveLength(2);
    expect(series.points[0]!.parts).toEqual({ a: 100, b: 50, "прочее": 25 });
    expect(series.points[0]!.total).toBe(175);
    expect(series.points[1]!.parts).toEqual({ a: 20, "прочее": 7 });
  });

  test("метрика cost: зафиксированная стоимость сильнее оценки", () => {
    const rows = [row("2026-10-01", "expensive", 1000, 0, 0, 3.5), row("2026-10-01", "cheap", 10_000, 0, 0, 0)];
    const series = buildSeries(rows, { metric: "cost", price, topN: 6 });
    // knownCost=3.5 берётся как есть; cheap оценивается ценой 1 за 1M => 10000*1/1e6
    expect(series.points[0]!.parts["expensive"]).toBe(3.5);
    expect(series.points[0]!.parts["cheap"]).toBe(0.01);
  });

  test("нулевые строки и нулевая оценка не дают точек", () => {
    const series = buildSeries([row("2026-10-01", "unknown-model", 0), row("2026-10-01", "none", 5)], {
      metric: "cost",
      price: () => 0,
    });
    expect(series.points).toEqual([]);
  });

  test("окно длиннее 120 дней сворачивается в недели (понедельник)", () => {
    const rows = [
      row("2026-01-05", "a", 10), // понедельник
      row("2026-01-08", "a", 15), // четверг той же недели
      row("2026-06-20", "b", 7),  // суббота
    ];
    const series = buildSeries(rows, { metric: "tokens", price, topN: 6 });
    expect(series.bucket).toBe("week");
    expect(series.points.map((point) => point.date)).toEqual(["2026-01-05", "2026-06-15"]);
    expect(series.points[0]!.total).toBe(25);
  });

  test("weekStart: сдвиг к понедельнику недели", () => {
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // суббота -> понедельник
    expect(weekStart("2026-10-05")).toBe("2026-10-05"); // понедельник
  });

  test("value-функция: ряд вызовов инструментов вместо токенов", () => {
    const rows = [
      { day: "2026-10-01", model: "Bash", inputTokens: 3, outputTokens: 0, cacheTokens: 0, knownCost: 0 },
      { day: "2026-10-01", model: "Read", inputTokens: 7, outputTokens: 0, cacheTokens: 0, knownCost: 0 },
      { day: "2026-10-02", model: "Bash", inputTokens: 1, outputTokens: 0, cacheTokens: 0, knownCost: 0 },
    ];
    const series = buildSeries(rows, { metric: "tokens", price, topN: 8, value: (row) => row.inputTokens });
    // порядок по суммарному значению: Read 7 > Bash 4
    expect(series.models).toEqual(["Read", "Bash"]);
    expect(series.points[0]!.parts).toEqual({ Bash: 3, Read: 7 });
    expect(series.points[0]!.total).toBe(10);
  });
});
