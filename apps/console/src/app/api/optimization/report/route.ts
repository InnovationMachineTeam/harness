import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { generateReport, OptimizationError } from "@/core/optimization";
import { OPTIMIZATION_KINDS, type OptimizationKind } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Генерация отчёта - синхронный запрос к провайдеру; ответ может занимать минуты. */
export const maxDuration = 300;

/**
 * POST /api/optimization/report {kind} - сформировать отчёт рекомендаций:
 * сводка статистики за 30 дней уходит провайдеру (исполнитель задачи
 * "Оптимизация", иначе провайдер по умолчанию), JSON-ответ сохраняется в state.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  const kind = body?.kind as OptimizationKind | undefined;
  if (!kind || !OPTIMIZATION_KINDS.includes(kind)) {
    return NextResponse.json({ error: "нужен kind: claudeInsights | codeburn" }, { status: 400 });
  }
  try {
    const report = await generateReport(ctx.repoRoot, ctx.state, kind);
    ctx.state.settings.optimization.reports[kind] = report;
    await ctx.saveState();
    invalidateDashboardCache();
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const message = error instanceof OptimizationError || error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
