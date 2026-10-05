import { NextResponse } from "next/server";
import { readTaskMetas } from "@/core/tasks";
import { effectiveModelPrice } from "@/core/pricingCatalog";
import { readCatalog } from "@/core/pricingCatalogServer";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { usageDailyAcrossWorkspaces, WorkflowStore } from "@/core/workflows/storage";
import { ensureSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore, type SessionIndexRow } from "@/core/sessionsIndex/store";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export type DrillType = "day" | "model" | "runtime" | "tool" | "project";

/** Строка задачи для детализации (ссылка на прогон - по correlation). */
interface DrillTask {
  id: string;
  kind: string;
  title: string;
  status: string;
  model: string | null;
  startedAt: string;
  finishedAt: string | null;
  runId: string | null;
}

/** Строка попытки workflow для детализации модели. */
interface DrillAttempt {
  runId: string;
  runTitle: string;
  workflowId: string;
  runStatus: string;
  stepId: string;
  section: string | null;
  status: string;
  startedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  costValue: number | null;
}

function sessionRow(row: SessionIndexRow) {
  return {
    runtime: row.runtime,
    sessionId: row.sessionId,
    title: row.title,
    workspaceDir: row.workspaceDir ?? row.projectDir,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    turns: row.turns,
    toolCalls: (row as SessionIndexRow & { toolCalls?: number }).toolCalls,
  };
}

/** Сумма по модели или рантайму за окно (rows day x измерение из всех workspace-хранилищ). */
function dimensionTotals(repoRoot: string, dimension: "model" | "runtime", key: string, sinceIso: string) {
  const rows = usageDailyAcrossWorkspaces(repoRoot, sinceIso, dimension).filter((row) => row.model === key);
  return rows.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheTokens: acc.cacheTokens + row.cacheTokens,
      knownCost: acc.knownCost + row.knownCost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheTokens: 0, knownCost: 0 },
  );
}

/**
 * GET /api/stats/drill?type=day|model|runtime|tool|project&key=<значение>&period=&workspace=
 * Детализация статистики (read-only):
 *  - day=<YYYY-MM-DD>: задачи дня, сессии дня (индекс), топ моделей дня;
 *  - model=<имя>: итоги, задачи консоли, попытки workflow (workspace), сессии индекса;
 *  - runtime=<id>: то же в разрезе рантайма (usage без рантайма - по провайдеру);
 *  - tool=<имя>: сессии с числом вызовов, дневные счётчики за окно;
 *  - project=<dir>: сессии рабочей папки.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const type = params.get("type") as DrillType | null;
  const key = (params.get("key") ?? "").trim();
  if (!type || !["day", "model", "runtime", "tool", "project"].includes(type) || !key) {
    return NextResponse.json({ error: "нужны параметры type (day|model|runtime|tool|project) и key" }, { status: 400 });
  }
  const periodDays = { "1d": 1, "1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365 }[params.get("period") ?? ""];
  const sinceIso = periodDays ? new Date(Date.now() - periodDays * 86_400_000).toISOString() : new Date(0).toISOString();

  try {
    if (type === "day") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NextResponse.json({ error: "key должен быть датой YYYY-MM-DD" }, { status: 400 });
      const metas = await readTaskMetas(ctx.repoRoot);
      const tasks: DrillTask[] = metas
        .filter((meta) => meta.startedAt.slice(0, 10) === key)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 50)
        .map((meta) => ({
          id: meta.id,
          kind: meta.kind,
          title: meta.title,
          status: meta.status,
          model: meta.model,
          startedAt: meta.startedAt,
          finishedAt: meta.finishedAt,
          runId: meta.workflowRunId ?? null,
        }));
      await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
      const store = new SessionIndexStore(ctx.repoRoot);
      const sessions = store.sessionsByDay(key).map(sessionRow);
      store.close();
      // топ моделей дня: строки day x model всех workspace за этот день
      const catalog = await readCatalog(ctx.repoRoot);
      const byModel = new Map<string, { inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number }>();
      for (const row of usageDailyAcrossWorkspaces(ctx.repoRoot, `${key}T00:00:00.000Z`)) {
        if (row.day !== key || !row.model) continue;
        const entry = byModel.get(row.model) ?? { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 };
        entry.inputTokens += row.inputTokens;
        entry.outputTokens += row.outputTokens;
        entry.cacheTokens += row.cacheTokens;
        const price = effectiveModelPrice(catalog, row.model);
        entry.costUsd += row.knownCost > 0 ? row.knownCost : price.origin !== "none" ? (row.inputTokens * price.inputPerMtok + row.outputTokens * price.outputPerMtok + row.cacheTokens * (price.cacheReadPerMtok ?? 0)) / 1e6 : 0;
        byModel.set(row.model, entry);
      }
      const models = [...byModel.entries()]
        .map(([model, totals]) => ({ model, ...totals, costUsd: Math.round(totals.costUsd * 10000) / 10000 }))
        .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
        .slice(0, 8);
      return NextResponse.json({ type, key, tasks, sessions, models });
    }

    if (type === "model" || type === "runtime") {
      const dimension = type === "runtime" ? "runtime" : "model";
      const totals = dimensionTotals(ctx.repoRoot, dimension, key, sinceIso);
      const metas = await readTaskMetas(ctx.repoRoot);
      const tasks: DrillTask[] = metas
        .filter((meta) => (type === "runtime" ? meta.executor.type === "runtime" && meta.executor.id === key : meta.model === key))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 30)
        .map((meta) => ({
          id: meta.id,
          kind: meta.kind,
          title: meta.title,
          status: meta.status,
          model: meta.model,
          startedAt: meta.startedAt,
          finishedAt: meta.finishedAt,
          runId: meta.workflowRunId ?? null,
        }));
      const workspace = resolveWorkflowWorkspace(ctx.state, params.get("workspace"));
      const store = new WorkflowStore(ctx.repoRoot, workspace);
      const attempts = store.attemptsBy(dimension, key, sinceIso) as unknown as DrillAttempt[];
      store.close();
      await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
      const index = new SessionIndexStore(ctx.repoRoot);
      const sessions = (
        type === "runtime" ? index.listSessions({ runtime: key, limit: 50 }) : index.sessionsByModel(key)
      ).map(sessionRow);
      index.close();
      return NextResponse.json({ type, key, totals, tasks, attempts, sessions });
    }

    if (type === "tool") {
      await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
      const store = new SessionIndexStore(ctx.repoRoot);
      const sessions = store.sessionsByTool(key).map(sessionRow);
      const toolDayRows = store.toolDayRows(sinceIso.slice(0, 10)).filter((row) => row.tool === key);
      store.close();
      const calls = toolDayRows.reduce((sum, row) => sum + row.calls, 0);
      return NextResponse.json({ type, key, calls, days: toolDayRows.slice(-14), sessions });
    }

    // project
    await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
    const store = new SessionIndexStore(ctx.repoRoot);
    const sessions = store.listSessions({ dir: key, limit: 100 }).map(sessionRow);
    store.close();
    return NextResponse.json({ type, key, sessions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
