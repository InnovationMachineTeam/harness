import { NextResponse } from "next/server";
import { readTaskMetas } from "@/core/tasks";
import { dayKey } from "@/lib/format";
import { effectiveModelPrice } from "@/core/pricingCatalog";
import { readCatalog } from "@/core/pricingCatalogServer";
import { ensureSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore } from "@/core/sessionsIndex/store";
import { usageDailyAcrossWorkspaces } from "@/core/workflows/storage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

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
  byTool: Record<string, HeatmapToolCell>;
}

/** Метрики heatmap: задачи консоли, сессии индекса, токены usage, стоимость usage (USD). */
export type HeatmapMetric = "tasks" | "sessions" | "tokens" | "cost";

/** Период heatmap в днях (окно выборки); "all" - без ограничения. */
export const HEATMAP_PERIOD_DAYS: Record<string, number> = { "1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365 };

/**
 * GET /api/stats/heatmap?months=6&metric=tasks&period=6m
 * Использование harness по дням. metric=tasks (по умолчанию) - каждая задача
 * консоли даёт один отсчёт; sessions - сессии рантаймов из индекса
 * sessions.sqlite (день старта сессии); tokens/cost - дневная агрегация
 * usage_receipts всех workspace-хранилищ, стоимость оценивается по каталогу
 * цен (официальная цена модели, иначе средняя).
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const monthsParam = Number(params.get("months") ?? "6");
  const months = Number.isFinite(monthsParam) && monthsParam >= 1 && monthsParam <= 24 ? monthsParam : 6;
  const metricParam = params.get("metric") ?? "tasks";
  const metric: HeatmapMetric = metricParam === "tokens" || metricParam === "cost" || metricParam === "sessions" ? metricParam : "tasks";
  const periodDays = HEATMAP_PERIOD_DAYS[params.get("period") ?? ""];
  const windowDays = periodDays ?? months * 30;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  if (metric === "sessions") {
    await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
    const store = new SessionIndexStore(ctx.repoRoot);
    const days = store.heatmapDays("sessions", since.toISOString());
    store.close();
    return NextResponse.json({ months, metric, days });
  }

  if (metric === "tasks") {
    const metas = await readTaskMetas(ctx.repoRoot);
    const byDay = new Map<string, Map<string, HeatmapToolCell>>();
    for (const meta of metas) {
      const started = new Date(meta.startedAt);
      if (Number.isNaN(started.getTime()) || started < since) continue;
      const date = dayKey(started);
      const key = `${meta.executor.type}:${meta.executor.id}`;
      let day = byDay.get(date);
      if (!day) byDay.set(date, (day = new Map()));
      let cell = day.get(key);
      if (!cell) {
        cell = { type: meta.executor.type, id: meta.executor.id, total: 0, completed: 0, failed: 0, running: 0, kinds: {} };
        day.set(key, cell);
      }
      cell.total += 1;
      if (meta.status === "completed") cell.completed += 1;
      else if (meta.status === "failed" || meta.status === "interrupted") cell.failed += 1;
      else cell.running += 1;
      cell.kinds[meta.kind] = (cell.kinds[meta.kind] ?? 0) + 1;
    }

    const days: HeatmapDay[] = [...byDay.entries()]
      .map(([date, tools]) => ({
        date,
        total: [...tools.values()].reduce((sum, cell) => sum + cell.total, 0),
        byTool: Object.fromEntries([...tools.entries()].sort((a, b) => b[1].total - a[1].total)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ months, metric, days });
  }

  // tokens/cost: дневные суммы usage по моделям; стоимость - известная либо оценка по каталогу
  const catalog = await readCatalog(ctx.repoRoot);
  const rows = usageDailyAcrossWorkspaces(ctx.repoRoot, since.toISOString());
  const totals = new Map<string, { tokens: number; cost: number }>();
  for (const row of rows) {
    const entry = totals.get(row.day) ?? { tokens: 0, cost: 0 };
    const tokens = row.inputTokens + row.outputTokens + row.cacheTokens;
    entry.tokens += tokens;
    if (row.knownCost > 0) {
      entry.cost += row.knownCost;
    } else if (row.model) {
      const price = effectiveModelPrice(catalog, row.model);
      if (price.origin !== "none") {
        entry.cost += (row.inputTokens * price.inputPerMtok + row.outputTokens * price.outputPerMtok + row.cacheTokens * (price.cacheReadPerMtok ?? 0)) / 1e6;
      }
    }
    totals.set(row.day, entry);
  }
  const days = [...totals.entries()]
    .map(([date, value]) => ({ date, total: metric === "tokens" ? value.tokens : Math.round(value.cost * 10000) / 10000 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json({ months, metric, days });
}
