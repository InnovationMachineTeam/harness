import { NextResponse } from "next/server";
import { OPTIMIZATION_KINDS, type OptimizationKind } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/optimization/done {kind, id, done} - ручная отметка рекомендации
 * отчёта выполненной (или снятие отметки). Предназначена для ручных
 * рекомендаций (mode = manual): у них нет запуска агентом.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { kind?: string; id?: unknown; done?: unknown } | null;
  const kind = body?.kind as OptimizationKind | undefined;
  if (!kind || !OPTIMIZATION_KINDS.includes(kind)) {
    return NextResponse.json({ error: "нужен kind: claudeInsights | codeburn" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "нужен id рекомендации" }, { status: 400 });
  }
  const report = ctx.state.settings.optimization.reports[kind];
  if (!report?.recommendations.some((rec) => rec.id === id)) {
    return NextResponse.json({ error: "рекомендации нет в текущем отчёте - обновите отчёт" }, { status: 400 });
  }
  const doneMap = ctx.state.settings.optimization.done[kind] ?? {};
  if (body?.done === false) {
    delete doneMap[id];
  } else {
    doneMap[id] = { at: new Date().toISOString(), via: "manual" };
  }
  ctx.state.settings.optimization.done[kind] = doneMap;
  await ctx.saveState();
  return NextResponse.json({ ok: true, done: doneMap });
}
