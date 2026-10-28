import { NextResponse } from "next/server";
import { ADAPTERS } from "@/runtimes";
import { computeNextRunAt, defaultRoutineExecutor, normalizeRoutineExecutor, validateRoutineInput, ROUTINE_MAX_ENABLED, ROUTINE_MIN_INTERVAL_MIN } from "@/core/routines";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { ensureWorkflowWorker, workflowWorkerStatus } from "@/core/workflows/worker";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Список рутин рабочей папки и последние запуски; открытие поднимает воркер (планировщик). */
export async function GET(request: Request) {
  const ctx = await serverContext();
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const routines = store.listRoutines();
    const runs = store.listRoutineRuns(null, 20);
    store.close();
    await ensureWorkflowWorker(ctx.repoRoot).catch(() => undefined);
    return NextResponse.json({ workspace, routines, runs, worker: await workflowWorkerStatus(ctx.repoRoot) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/** Создание рутины: интервал от 15 минут или cron-выражение (не чаще 5 минут); потолок включённых - 20. */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as {
    workspace?: string;
    title?: string;
    prompt?: string;
    executor?: string;
    intervalMin?: number;
    scheduleType?: "interval" | "cron";
    cronExpr?: string;
    enabled?: boolean;
  } | null;
  try {
    const checked = validateRoutineInput({ title: body?.title, prompt: body?.prompt, intervalMin: body?.intervalMin ?? 60, scheduleType: body?.scheduleType, cronExpr: body?.cronExpr });
    if ("errors" in checked) throw new Error(checked.errors.join("; "));
    const workspace = resolveWorkflowWorkspace(ctx.state, body?.workspace);
    const executor = normalizeRoutineExecutor(ctx.state, body?.executor?.trim() || defaultRoutineExecutor(ctx.state));
    if (!executor) throw new Error("исполнитель задан некорректно (идентификатор рантайма или provider:<id>)");
    if (!executor.startsWith("provider:") && !ADAPTERS[executor]) {
      throw new Error("рантайм не найден в реестре адаптеров: " + executor);
    }
    const enabled = body?.enabled ?? true;
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    let routine;
    try {
      if (enabled && store.countEnabledRoutines() >= ROUTINE_MAX_ENABLED) {
        throw new Error(`потолок включённых рутин (${ROUTINE_MAX_ENABLED}); выключите неиспользуемые`);
      }
      routine = store.createRoutine({
        workspaceDir: workspace,
        title: checked.title,
        prompt: checked.prompt,
        executor,
        intervalMin: checked.intervalMin,
        scheduleType: checked.scheduleType,
        cronExpr: checked.cronExpr,
        enabled,
        nextRunAt: enabled ? computeNextRunAt(checked) : null,
      });
    } finally {
      store.close();
    }
    // воркер - исполнитель расписания; поднимаем сразу после создания
    await ensureWorkflowWorker(ctx.repoRoot).catch(() => undefined);
    return NextResponse.json({ routine, minIntervalMin: ROUTINE_MIN_INTERVAL_MIN }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
