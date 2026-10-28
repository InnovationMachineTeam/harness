import { NextResponse } from "next/server";
import { readReaAnalyses, reaAnalysesFile, reaCliStatus, reaDataDir, reaProvidersSync, REA_OPERATIONS } from "@/core/rea";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/rea - статус CLI, каталог операций, провайдеры анализа и реестр
 * анализов (последние 50). Артефакты - .agents/console/rea/.
 */
export async function GET() {
  const ctx = await serverContext();
  const cli = reaCliStatus();
  const { providers, error } = cli.installed ? reaProvidersSync() : { providers: [], error: null };
  return NextResponse.json({
    cli,
    providers,
    providerError: error,
    catalog: REA_OPERATIONS.map(({ id, label, hint, tab }) => ({ id, label, hint, tab })),
    analyses: await readReaAnalyses(ctx.repoRoot),
    dataDir: reaDataDir(ctx.repoRoot),
    analysesFile: reaAnalysesFile(ctx.repoRoot),
  });
}
