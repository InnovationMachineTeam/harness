import { NextResponse } from "next/server";
import { listProbeSummaries, proposeVariants, PROBE_MAX_VARIANTS } from "@/core/probing";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/optimization/probe - сводки контрастивных проб и доступные рантаймы. */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({
    runs: await listProbeSummaries(ctx.repoRoot),
    runtimes: Object.keys(ctx.adapters),
    maxVariants: PROBE_MAX_VARIANTS,
  });
}

/**
 * POST /api/optimization/probe {action: "propose", taskPrompt, k?} - провайдер
 * предлагает варианты обвеса (блоки инструкций) по задаче и принятым урокам.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { action?: string; taskPrompt?: unknown; k?: unknown } | null;
  if (body?.action !== "propose") {
    return NextResponse.json({ error: "нужен action: propose" }, { status: 400 });
  }
  const taskPrompt = typeof body.taskPrompt === "string" ? body.taskPrompt : "";
  const k = typeof body.k === "number" ? body.k : undefined;
  const result = await proposeVariants(ctx.repoRoot, ctx.state, { taskPrompt, k });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
