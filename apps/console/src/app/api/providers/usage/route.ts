import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { copyFile, access } from "node:fs/promises";
import path from "node:path";
import { markUsageCollected, providerUsageSummary, readProviderUsage } from "@/core/providerUsage";
import { collectRuntimeUsage } from "@/core/usage/runtimeTranscripts";
import { collectToolLedgers } from "@/core/usage/toolLedgers";
import { serverContext } from "@/lib/server-context";
import { WorkflowStore } from "@/core/workflows/storage";

export const dynamic = "force-dynamic";

const COLLECT_TTL_MS = 5 * 60_000;

/**
 * GET /api/providers/usage - статистика использования токенов по провайдерам
 * (записи трёх источников, агрегаты totals и по дням). Внешние источники
 * (транскрипты рантаймов, ledger'ы инструментов) собираются лениво - не чаще
 * раза в COLLECT_TTL_MS; вызовы консоли пишутся в момент выполнения.
 */
export async function GET() {
  const ctx = await serverContext();
  const store = await readProviderUsage(ctx.repoRoot);
  const collectedAtMs = store.collectedAt ? Date.parse(store.collectedAt) : NaN;
  if (!(Date.now() - collectedAtMs < COLLECT_TTL_MS)) {
    await collectRuntimeUsage(ctx.repoRoot).catch(() => 0);
    await collectToolLedgers(ctx.repoRoot).catch(() => 0);
    await markUsageCollected(ctx.repoRoot);
  }
  const legacy = await providerUsageSummary(ctx.repoRoot);
  const source = path.join(ctx.repoRoot, ".agents", "console", "provider-usage.json");
  const backup = path.join(ctx.repoRoot, ".agents", "console", "provider-usage.backup.json");
  await access(backup).catch(() => copyFile(source, backup).catch(() => undefined));
  const workflowStore = new WorkflowStore(ctx.repoRoot, ctx.state.workspaces.mandatory);
  for (const record of legacy.records) {
    workflowStore.recordUsage({ receiptId: "legacy-" + createHash("sha256").update(JSON.stringify(record)).digest("hex"), provider: record.provider, runtime: record.runtime, model: record.model, inputTokens: record.inputTokens, outputTokens: record.outputTokens, cacheTokens: record.details?.cache_read ?? 0, raw: record });
  }
  const receipts = workflowStore.listUsageReceipts();
  workflowStore.close();
  const totals: Record<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; lastAt: string | null; models: Record<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number }> }> = {};
  const records = receipts.map((row) => ({ at: String(row.at), source: "provider-run", provider: String(row.provider), model: row.model ? String(row.model) : undefined, runtime: row.runtime ? String(row.runtime) : undefined, inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), totalTokens: Number(row.input_tokens) + Number(row.output_tokens) + Number(row.cache_tokens) }));
  for (const record of records) {
    const bucket = (totals[record.provider] ??= { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, lastAt: null, models: {} });
    bucket.calls += 1; bucket.inputTokens += record.inputTokens; bucket.outputTokens += record.outputTokens; bucket.totalTokens += record.totalTokens; if (!bucket.lastAt || record.at > bucket.lastAt) bucket.lastAt = record.at;
    if (record.model) { const model = (bucket.models[record.model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }); model.calls += 1; model.inputTokens += record.inputTokens; model.outputTokens += record.outputTokens; model.totalTokens += record.totalTokens; }
  }
  return NextResponse.json({ records: records.slice(0, 200), totals, days: legacy.days, collectedAt: legacy.collectedAt, source: "workflow-ledger" });
}
