import { NextResponse } from "next/server";
import { effectiveModelPrice } from "@/core/pricingCatalog";
import { readCatalog } from "@/core/pricingCatalogServer";
import { buildSeries, SERIES_PERIOD_DAYS, type SeriesMetric } from "@/core/statsSeries";
import { usageDailyAcrossWorkspaces } from "@/core/workflows/storage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/series?metric=tokens|cost&period=1d..all&by=model|runtime
 * Дневной ряд usage для графика расхода: строки day x модель/рантайм из
 * usage_receipts всех workspace-хранилищ, топ-6 (остаток - "прочее");
 * окна длиннее 120 дней - недельные корзины. Стоимость - зафиксированная
 * (knownCost) плюс оценка по каталогу цен.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const metricParam = params.get("metric") ?? "cost";
  const metric: SeriesMetric = metricParam === "tokens" ? "tokens" : "cost";
  const by = params.get("by") === "runtime" ? "runtime" : "model";
  const days = SERIES_PERIOD_DAYS[params.get("period") ?? ""];
  const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);

  try {
    const rows = usageDailyAcrossWorkspaces(ctx.repoRoot, since.toISOString(), by) as unknown as Parameters<typeof buildSeries>[0];
    const catalog = await readCatalog(ctx.repoRoot);
    const price = (model: string, inputTokens: number, outputTokens: number, cacheTokens: number): number => {
      const entry = effectiveModelPrice(catalog, model);
      if (entry.origin === "none") return 0;
      return (inputTokens * entry.inputPerMtok + outputTokens * entry.outputPerMtok + cacheTokens * (entry.cacheReadPerMtok ?? 0)) / 1e6;
    };
    const series = buildSeries(rows, { metric, price, topN: 6 });
    return NextResponse.json({ metric, by, period: params.get("period") ?? "all", ...series });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
