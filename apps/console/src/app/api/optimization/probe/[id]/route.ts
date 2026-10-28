import { NextResponse } from "next/server";
import { buildAdoptPrompt, markProbeAdopted, readProbeRun } from "@/core/probing";
import { launchPromptRun } from "@/core/prompts";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/optimization/probe/<id> - проба целиком: варианты, результаты, контрастный отчёт. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  const run = await readProbeRun(ctx.repoRoot, id);
  if (!run) return NextResponse.json({ error: "проба не найдена" }, { status: 404 });
  return NextResponse.json({ run });
}

/**
 * POST /api/optimization/probe/<id> {action: "adopt", variantId, runtimeId?} -
 * внедрение варианта: агент рантайма применяет замены варианта в основной
 * рабочей папке (правки .agents/roles|skills проходят guard-правило
 * structural.agents-mutation - одобрение оператора в сессии рантайма).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string; variantId?: unknown; runtimeId?: unknown } | null;
  if (body?.action !== "adopt") {
    return NextResponse.json({ error: "нужен action: adopt" }, { status: 400 });
  }
  const run = await readProbeRun(ctx.repoRoot, id);
  if (!run) return NextResponse.json({ error: "проба не найдена" }, { status: 404 });
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  const variant = run.variants.find((item) => item.id === variantId);
  if (!variant) return NextResponse.json({ error: "вариант не найден в пробе" }, { status: 400 });

  const runtimeId = typeof body.runtimeId === "string" && body.runtimeId ? body.runtimeId : run.runtimeId;
  const adapter = ctx.adapters[runtimeId];
  if (!adapter) return NextResponse.json({ error: "неизвестный рантайм: " + runtimeId }, { status: 400 });
  const launched = await launchPromptRun({
    repoRoot: ctx.repoRoot,
    adapter,
    runtimeId,
    prompt: buildAdoptPrompt(run, variant),
    cwd: run.workspaceDir,
  });
  if (!launched.ok) return NextResponse.json(launched, { status: 400 });
  const updated = await markProbeAdopted(ctx.repoRoot, id, variantId);
  return NextResponse.json({ ok: true, variantId, runtime: runtimeId, logFile: launched.logFile, detail: launched.detail, run: updated });
}
