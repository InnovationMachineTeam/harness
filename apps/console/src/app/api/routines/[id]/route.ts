import { NextResponse } from "next/server";
import { ADAPTERS } from "@/runtimes";
import { computeNextRunAt, normalizeRoutineExecutor, validateRoutineInput, ROUTINE_MAX_ENABLED } from "@/core/routines";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { ensureWorkflowWorker } from "@/core/workflows/worker";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

async function openStore(ctx: Awaited<ReturnType<typeof serverContext>>, workspace: string | undefined, id: string) {
  const store = new WorkflowStore(ctx.repoRoot, resolveWorkflowWorkspace(ctx.state, workspace));
  const routine = store.getRoutine(id);
  if (!routine) {
    store.close();
    throw new Error("рутина не найдена");
  }
  return { store, routine };
}

/** Рутина и её последние запуски. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  try {
    const { store, routine } = await openStore(ctx, new URL(request.url).searchParams.get("workspace") ?? undefined, id);
    const runs = store.listRoutineRuns(id, 10);
    store.close();
    return NextResponse.json({ routine, runs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

/** Правка рутины: смена расписания (интервал или cron) или включение пересчитывает следующий запуск от текущего момента. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
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
    const { store, routine } = await openStore(ctx, body?.workspace, id);
    try {
      const patch: {
        title?: string;
        prompt?: string;
        executor?: string;
        intervalMin?: number;
        scheduleType?: "interval" | "cron";
        cronExpr?: string | null;
        enabled?: boolean;
        nextRunAt?: string | null;
      } = {};
      const scheduleTouched = body?.title !== undefined || body?.prompt !== undefined || body?.intervalMin !== undefined
        || body?.scheduleType !== undefined || body?.cronExpr !== undefined;
      if (scheduleTouched) {
        const checked = validateRoutineInput({
          title: body?.title ?? routine.title,
          prompt: body?.prompt ?? routine.prompt,
          intervalMin: body?.scheduleType === "cron" ? body?.intervalMin : (body?.intervalMin ?? routine.intervalMin),
          scheduleType: body?.scheduleType ?? routine.scheduleType,
          cronExpr: body?.cronExpr ?? routine.cronExpr ?? undefined,
        });
        if ("errors" in checked) throw new Error(checked.errors.join("; "));
        patch.title = checked.title;
        patch.prompt = checked.prompt;
        patch.intervalMin = checked.intervalMin;
        patch.scheduleType = checked.scheduleType;
        patch.cronExpr = checked.cronExpr;
      }
      if (body?.executor !== undefined && body.executor.trim() && body.executor.trim() !== routine.executor) {
        const executor = normalizeRoutineExecutor(ctx.state, body.executor);
        if (!executor) throw new Error("исполнитель задан некорректно");
        if (!executor.startsWith("provider:") && !ADAPTERS[executor]) throw new Error("рантайм не найден в реестре адаптеров: " + executor);
        patch.executor = executor;
      }
      const enabling = body?.enabled === true && !routine.enabled;
      if (enabling && store.countEnabledRoutines() >= ROUTINE_MAX_ENABLED) {
        throw new Error(`потолок включённых рутин (${ROUTINE_MAX_ENABLED}); выключите неиспользуемые`);
      }
      if (body?.enabled !== undefined) patch.enabled = body.enabled;
      // включение или смена расписания у включённой рутины - новый отсчёт от текущего момента
      const scheduleChanged = scheduleTouched && (
        (patch.scheduleType ?? routine.scheduleType) !== routine.scheduleType
        || (patch.cronExpr ?? routine.cronExpr ?? null) !== routine.cronExpr
        || (patch.intervalMin !== undefined && patch.intervalMin !== routine.intervalMin)
      );
      if ((enabling || scheduleChanged) && (patch.enabled ?? routine.enabled)) {
        patch.nextRunAt = computeNextRunAt({
          scheduleType: patch.scheduleType ?? routine.scheduleType,
          intervalMin: patch.intervalMin ?? routine.intervalMin,
          cronExpr: patch.cronExpr !== undefined ? patch.cronExpr : routine.cronExpr,
        });
      }
      store.updateRoutine(id, patch);
      return NextResponse.json({ routine: store.getRoutine(id) });
    } finally {
      store.close();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/** Удаление рутины вместе с историей запусков. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  try {
    const { store } = await openStore(ctx, new URL(request.url).searchParams.get("workspace") ?? undefined, id);
    try {
      store.deleteRoutine(id);
      return NextResponse.json({ ok: true });
    } finally {
      store.close();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

/** "Запустить сейчас": ставит запрос ручного запуска - исполнит воркер на ближайшем тике. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { workspace?: string } | null;
  try {
    const { store } = await openStore(ctx, body?.workspace ?? undefined, id);
    try {
      store.requestManualRun(id);
    } finally {
      store.close();
    }
    const worker = await ensureWorkflowWorker(ctx.repoRoot);
    return NextResponse.json({ queued: true, worker }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
