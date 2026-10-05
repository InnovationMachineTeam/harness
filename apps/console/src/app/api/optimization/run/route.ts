import { NextResponse } from "next/server";
import { buildOptimizePrompt, readinessError } from "@/core/optimization";
import { launchPromptRun } from "@/core/prompts";
import { parseTaskProviderId } from "@/core/providers";
import { launchProviderRun } from "@/core/providerRun";
import { OPTIMIZATION_KINDS, resolveOptimizationExecutor, type OptimizationKind } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/optimization/run {kind, ids} - запуск оптимизации: промпт из
 * выбранных рекомендаций отчёта уходит исполнителю задачи "Оптимизация"
 * (headless-рантайм или провайдер). При успешном запуске фиксируется время
 * последней оптимизации; задача видна в "Мониторинг → Задачи".
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { kind?: string; ids?: unknown } | null;
  const kind = body?.kind as OptimizationKind | undefined;
  if (!kind || !OPTIMIZATION_KINDS.includes(kind)) {
    return NextResponse.json({ error: "нужен kind: claudeInsights | codeburn" }, { status: 400 });
  }
  const report = ctx.state.settings.optimization.reports[kind];
  if (!report) {
    return NextResponse.json({ error: "отчёт не сформирован - сначала нажмите \"Обновить отчёт\"" }, { status: 400 });
  }
  const notReady = await readinessError(ctx.repoRoot, ctx.state, kind);
  if (notReady) {
    return NextResponse.json({ error: notReady }, { status: 400 });
  }
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "не выбрано ни одной рекомендации" }, { status: 400 });
  }
  const selected = ids
    .map((id) => report.recommendations.find((rec) => rec.id === id))
    .filter((rec): rec is NonNullable<typeof rec> => Boolean(rec));
  if (selected.length === 0) {
    return NextResponse.json({ error: "выбранных рекомендаций нет в отчёте - обновите отчёт" }, { status: 400 });
  }

  const prompt = buildOptimizePrompt(kind, selected);
  const executor = resolveOptimizationExecutor(ctx.state);
  const providerId = parseTaskProviderId(executor);
  const result = providerId !== null
    ? await launchProviderRun({ repoRoot: ctx.repoRoot, state: ctx.state, providerId, prompt, taskKind: "optimization-run" })
    : await launchRuntimePrompt(ctx, executor, prompt);
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  ctx.state.settings.optimization.lastOptimizedAt[kind] = new Date().toISOString();
  await ctx.saveState();
  return NextResponse.json(result);
}

/** Запуск промта в headless-рантайме; отсутствие адаптера - ошибка запуска. */
async function launchRuntimePrompt(
  ctx: Awaited<ReturnType<typeof serverContext>>,
  runtimeId: string,
  prompt: string,
) {
  const adapter = ctx.adapters[runtimeId];
  if (!adapter) {
    return { ok: false, runtime: runtimeId, logFile: "", pid: null, detail: `неизвестный рантайм: ${runtimeId}` };
  }
  return launchPromptRun({ repoRoot: ctx.repoRoot, adapter, runtimeId, prompt });
}
