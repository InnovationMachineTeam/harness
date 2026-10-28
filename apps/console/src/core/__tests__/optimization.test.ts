import { describe, expect, test } from "bun:test";
import { buildOptimizePrompt, buildReportPrompt } from "@/core/optimization";
import { normalizeOptimization, normalizeOptimizationReport } from "@/core/state";

describe("normalizeOptimizationReport", () => {
  test("mode сохраняется; отсутствие - auto", () => {
    const report = normalizeOptimizationReport({
      generatedAt: "2026-10-15T00:00:00.000Z",
      recommendations: [
        { id: "a", title: "A", detail: "сделать A", impact: "high", mode: "auto" },
        { id: "b", title: "B", detail: "сделать B вручную", mode: "manual" },
        { id: "c", title: "C", detail: "старый отчёт без mode" },
        { id: "d", title: "D", detail: "битый mode", mode: "иногда" },
      ],
    });
    expect(report).not.toBeNull();
    expect(report?.recommendations.map((rec) => rec.mode)).toEqual(["auto", "manual", "auto", "auto"]);
  });

  test("scope: путь сохраняется, пустое и отсутствующее - undefined", () => {
    const report = normalizeOptimizationReport({
      generatedAt: "2026-10-15T00:00:00.000Z",
      recommendations: [
        { id: "a", title: "A", detail: "d", scope: "/Users/x/Developer/harness" },
        { id: "b", title: "B", detail: "d", scope: "global" },
        { id: "c", title: "C", detail: "d" },
        { id: "d", title: "D", detail: "d", scope: "   " },
      ],
    });
    expect(report?.recommendations.map((rec) => rec.scope)).toEqual([
      "/Users/x/Developer/harness",
      "global",
      undefined,
      undefined,
    ]);
  });

  test("битые записи отбрасываются", () => {
    const report = normalizeOptimizationReport({
      generatedAt: "не дата",
      recommendations: [{ id: "x", title: "X", detail: "Y" }],
    });
    expect(report).toBeNull();
    const report2 = normalizeOptimizationReport({
      generatedAt: "2026-10-15T00:00:00.000Z",
      recommendations: [{ id: "", title: "нет id", detail: "y" }, { title: "нет id2", detail: "y" }],
    });
    expect(report2?.recommendations).toHaveLength(0);
  });
});

describe("normalizeOptimization", () => {
  test("done: корректные записи сохраняются, битые отбрасываются", () => {
    const settings = normalizeOptimization({
      done: {
        codeburn: {
          cached: { at: "2026-10-15T01:00:00.000Z", via: "run" },
          marked: { at: "2026-10-15T02:00:00.000Z", via: "manual" },
          broken: { at: "не дата", via: "manual" },
          badvia: { at: "2026-10-15T03:00:00.000Z", via: "teleport" },
          "": { at: "2026-10-15T04:00:00.000Z", via: "manual" },
        },
        claudeInsights: "мусор",
      },
    });
    expect(Object.keys(settings.done.codeburn)).toEqual(["cached", "marked"]);
    expect(settings.done.codeburn.cached).toEqual({ at: "2026-10-15T01:00:00.000Z", via: "run" });
    expect(settings.done.claudeInsights).toEqual({});
  });

  test("без done - пустые карты по видам", () => {
    const settings = normalizeOptimization(null);
    expect(settings.done).toEqual({ claudeInsights: {}, codeburn: {} });
  });
});

describe("промпты", () => {
  test("промпт отчёта требует классификацию mode и scope", () => {
    const prompt = buildReportPrompt("codeburn", { totals: {}, configuredWorkspaces: ["/repo"] });
    expect(prompt).toContain('"mode":"auto|manual"');
    expect(prompt).toContain("manual - требуется ручное действие человека вне репозитория");
    expect(prompt).toContain('"scope":"global|<путь рабочей папки>"');
    expect(prompt).toContain("configuredWorkspaces");
  });

  test("промпт запуска перечисляет выбранные рекомендации", () => {
    const prompt = buildOptimizePrompt("codeburn", [
      { id: "a", title: "Кеш", detail: "включить кеш" },
    ]);
    expect(prompt).toContain("1. Кеш");
    expect(prompt).toContain("включить кеш");
  });
});
