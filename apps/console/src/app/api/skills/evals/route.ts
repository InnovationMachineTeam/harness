import { NextResponse } from "next/server";
import { readSkillEvalsCatalog, listSkillEvalsSummaries, startSkillEvalsRun } from "@/core/skillEvals";
import { resolveOptimizationExecutor } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/skills/evals - каталог навыков с evals, исполнители и сводки прогонов. */
export async function GET() {
  const ctx = await serverContext();
  const catalog = await readSkillEvalsCatalog(ctx.repoRoot);
  const executor = resolveOptimizationExecutor(ctx.state);
  return NextResponse.json({
    catalog: catalog.map((entry) => ({ skillId: entry.skillId, title: entry.title, tags: entry.tags, caseCount: entry.cases.length })),
    executor,
    executors: [...Object.keys(ctx.adapters), executor],
    reports: await listSkillEvalsSummaries(ctx.repoRoot),
  });
}

/**
 * POST /api/skills/evals {skillIds, runtimes} - запуск прогона оценки навыков:
 * отвязанный раннер исполняет кейсы и оценивает их судьёй-провайдером; задача
 * видна в "Мониторинг → Задачи", прогресс - в report.json папки задачи.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { skillIds?: unknown; runtimes?: unknown } | null;
  const skillIds = Array.isArray(body?.skillIds) ? body.skillIds.filter((id): id is string => typeof id === "string") : [];
  const runtimes = Array.isArray(body?.runtimes) ? body.runtimes.filter((id): id is string => typeof id === "string") : [];
  const result = await startSkillEvalsRun(ctx.repoRoot, ctx.state, { skillIds, runtimes });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
