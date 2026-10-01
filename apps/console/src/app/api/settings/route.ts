import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import type { TaskKind, TaskRuntimes } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const TASKS: TaskKind[] = ["promptExecution", "skillCreation"];

/** GET /api/settings - рантаймы под задачи (null = "по умолчанию" ★). */
export async function GET() {
  const { state, adapters } = await serverContext();
  return NextResponse.json({
    defaultRuntime: state.defaultRuntime,
    taskRuntimes: state.settings.taskRuntimes,
    installed: Object.keys(adapters),
  });
}

/** PUT /api/settings {taskRuntimes: {promptExecution, skillCreation}} */
export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { taskRuntimes?: Partial<TaskRuntimes> } | null;
  const incoming = body?.taskRuntimes;
  if (!incoming) return NextResponse.json({ error: "нужен taskRuntimes" }, { status: 400 });

  for (const task of TASKS) {
    const value = incoming[task];
    if (value === undefined) continue;
    if (value !== null && !ctx.adapters[value]) {
      return NextResponse.json({ error: `неизвестный рантайм для ${task}: ${value}` }, { status: 400 });
    }
    ctx.state.settings.taskRuntimes[task] = value;
  }
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, taskRuntimes: ctx.state.settings.taskRuntimes });
}
