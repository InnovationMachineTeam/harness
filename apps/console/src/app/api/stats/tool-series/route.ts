import { NextResponse } from "next/server";
import { ensureSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore } from "@/core/sessionsIndex/store";
import { buildSeries, SERIES_PERIOD_DAYS } from "@/core/statsSeries";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/tool-series?period=1d..all
 * Ряд вызовов инструментов сессий по дням (sessions.sqlite, tool_usage):
 * топ-8 инструментов, остальные в "прочее"; значение точки - число вызовов.
 * Окна длиннее 120 дней - недельные корзины.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const days = SERIES_PERIOD_DAYS[params.get("period") ?? ""];
  const sinceDay = new Date(Date.now() - (days ?? 730) * 86_400_000).toISOString().slice(0, 10);

  try {
    await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
    const store = new SessionIndexStore(ctx.repoRoot);
    const rows = store.toolDayRows(sinceDay);
    store.close();
    const series = buildSeries(
      rows.map((row) => ({ day: row.day, model: row.tool, inputTokens: row.calls, outputTokens: 0, cacheTokens: 0, knownCost: 0 })),
      { metric: "tokens", price: () => 0, topN: 8, value: (row) => row.inputTokens },
    );
    return NextResponse.json({ period: params.get("period") ?? "all", ...series });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
