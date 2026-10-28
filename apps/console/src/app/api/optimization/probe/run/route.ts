import { NextResponse } from "next/server";
import { startProbeRun } from "@/core/probing";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/optimization/probe/run {taskPrompt, variants, runtimeId, workspace?} -
 * запуск контрастивной пробы: отвязанный раннер создаёт worktree на вариант,
 * исполняет задачу в каждом и строит контрастный отчёт провайдером. Задача
 * видна в "Мониторинг → Задачи".
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { taskPrompt?: unknown; variants?: unknown; runtimeId?: unknown; workspace?: unknown } | null;
  const taskPrompt = typeof body?.taskPrompt === "string" ? body.taskPrompt : "";
  const variants = body?.variants;
  const runtimeId = typeof body?.runtimeId === "string" ? body.runtimeId : "";
  const workspaceDir = typeof body?.workspace === "string" && body.workspace ? body.workspace : undefined;
  const result = await startProbeRun(ctx.repoRoot, ctx.state, { taskPrompt, variants, runtimeId, workspaceDir });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
