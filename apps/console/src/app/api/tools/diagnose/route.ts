import { NextResponse } from "next/server";
import { runToolDiagnostics } from "@/core/toolDiagnostics";
import { toolById } from "@/core/tools";
import { appendUsageEvent } from "@/core/toolsUsage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/tools/diagnose {toolId} - проверки "работает ли инструмент":
 * CLI, зависимости, per-runtime интеграции, MCP, дашборд. При провалах
 * возвращается готовый промпт headless-исправления (запуск -
 * POST /api/prompts/run {prompt}).
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { toolId?: string } | null;
  const toolId = body?.toolId ?? "";
  if (!toolById(toolId)) return NextResponse.json({ error: `инструмент не найден: ${toolId}` }, { status: 404 });
  const diagnostic = await runToolDiagnostics(ctx.repoRoot, ctx.state, toolId);
  if (!diagnostic) return NextResponse.json({ error: "диагностика недоступна" }, { status: 400 });
  await appendUsageEvent(ctx.repoRoot, { tool: toolId, action: "diagnose" });
  return NextResponse.json(diagnostic);
}
