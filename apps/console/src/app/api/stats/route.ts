import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { agentPlaneStatus } from "@/core/tools/agentplane-status";
import { ensureSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore } from "@/core/sessionsIndex/store";
import { effectiveModelPrice } from "@/core/pricingCatalog";
import { readCatalog } from "@/core/pricingCatalogServer";
import { serverContext } from "@/lib/server-context";
import { readProviderUsage } from "@/core/providerUsage";

export const dynamic = "force-dynamic";

/** Период статистики в днях; "all" - без ограничения. */
export const STATS_PERIOD_DAYS: Record<string, number> = { "1d": 1, "1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365 };

export async function GET(request: Request) {
  const ctx = await serverContext();
  try {
    const params = new URL(request.url).searchParams;
    const workspace = resolveWorkflowWorkspace(ctx.state, params.get("workspace"));
    const period = params.get("period") ?? "all";
    const days = STATS_PERIOD_DAYS[period];
    const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
    const runtime = params.get("runtime");
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    if (!store.hasMigration("provider-usage-v1")) {
      const legacy = await readProviderUsage(ctx.repoRoot);
      legacy.records.forEach((record) => store.recordUsage({
        receiptId: "legacy-" + createHash("sha256").update(JSON.stringify(record)).digest("hex"),
        provider: record.provider, runtime: record.runtime, model: record.model,
        inputTokens: record.inputTokens, outputTokens: record.outputTokens,
        cacheTokens: record.details?.cache_read ?? record.details?.cached ?? 0, raw: record,
      }));
      store.markMigration("provider-usage-v1");
    }
    const stats = store.stats({ since, runtime });
    store.close();
    // Стоимость: сначала зафиксированный cost (price card рантайма / конверт),
    // для записей без него - эффективная цена каталога (официальная -> средняя).
    const catalog = await readCatalog(ctx.repoRoot);
    let estimatedCost = 0;
    let pricedTokens = 0;
    let totalTokens = 0;
    for (const row of stats.usage as { inputTokens: number | null; outputTokens: number | null; cacheTokens: number | null; knownCost: number | null; model: string | null }[]) {
      const tokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.cacheTokens ?? 0);
      totalTokens += tokens;
      if ((row.knownCost ?? 0) > 0) {
        pricedTokens += tokens;
        continue;
      }
      const price = row.model ? effectiveModelPrice(catalog, row.model) : { inputPerMtok: 0, outputPerMtok: 0, cacheReadPerMtok: 0, origin: "none" as const };
      if (price.origin !== "none") {
        estimatedCost += ((row.inputTokens ?? 0) * price.inputPerMtok + (row.outputTokens ?? 0) * price.outputPerMtok + (row.cacheTokens ?? 0) * (price.cacheReadPerMtok ?? 0)) / 1e6;
        pricedTokens += tokens;
      }
    }
    // Сессии рантаймов из накопленного индекса (тот же период); сбой индекса
    // не ломает основную статистику
    let sessionsIndex: Awaited<ReturnType<SessionIndexStore["summary"]>> | null = null;
    try {
      await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
      const index = new SessionIndexStore(ctx.repoRoot);
      sessionsIndex = index.summary(since ?? new Date(0).toISOString());
      index.close();
    } catch {
      sessionsIndex = null;
    }
    return NextResponse.json({
      workspace,
      ...stats,
      period,
      sessions: sessionsIndex,
      totals: {
        ...stats.totals,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
        costUsd: (stats.totals.knownCost ?? 0) + estimatedCost,
        pricedTokens,
        totalTokens,
        coverage: totalTokens > 0 ? Math.round((pricedTokens / totalTokens) * 100) / 100 : 1,
      },
      privacy: "metadata",
      cost: { rule: "Известная стоимость - price card рантайма или конверт; для остальных записей - эффективная цена каталога (официальная, иначе средняя)", subscriptionAllocated: false },
      agentplane: agentPlaneStatus(workspace),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
