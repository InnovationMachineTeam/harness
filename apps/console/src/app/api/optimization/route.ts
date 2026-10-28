import { NextResponse } from "next/server";
import { optimizationReadiness } from "@/core/optimization";
import { resolveOptimizationExecutor } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/optimization - отчёты, время последних запусков, выполненные рекомендации, исполнитель и готовность. */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({
    reports: ctx.state.settings.optimization.reports,
    lastOptimizedAt: ctx.state.settings.optimization.lastOptimizedAt,
    done: ctx.state.settings.optimization.done,
    executor: resolveOptimizationExecutor(ctx.state),
    readiness: await optimizationReadiness(ctx.repoRoot, ctx.state),
  });
}
