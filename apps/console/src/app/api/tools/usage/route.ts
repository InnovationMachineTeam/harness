import { NextResponse } from "next/server";
import { collectUsage } from "@/core/toolsUsage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools/usage - события из .agents/console/tools-usage.json +
 * свежие снапшоты внешних метрик (rtk gain, headroom savings - только
 * CLI/файлы, без HTTP-запросов на локальные порты).
 */
export async function GET() {
  const { repoRoot } = await serverContext();
  const usage = await collectUsage(repoRoot);
  return NextResponse.json(usage);
}
