import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import { applyUpdateResults, buildUpdateSteps } from "@/core/updates";
import { getToolJob, startToolJob } from "@/core/toolJobs";

export const dynamic = "force-dynamic";

/**
 * Запуск обновления выбранных записей реестра: POST { ids } → один job с
 * шагами по записи (stepId = id). Клиент присылает только идентификаторы -
 * команды строятся на сервере из реестра. По завершении job'а статусы
 * (успех/ошибка и время) пишутся в реестр.
 */
export async function POST(request: Request) {
  const repoRoot = findRepoRoot();
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "не выбраны записи для обновления" }, { status: 400 });
  }
  const built = buildUpdateSteps(repoRoot, ids);
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  let jobId = "";
  const started = startToolJob({
    toolId: "update",
    action: "update",
    steps: built.steps,
    defaultCwd: repoRoot,
    onDone: () => {
      const finished = getToolJob(jobId);
      if (finished) applyUpdateResults(repoRoot, finished.results);
    },
  });
  if ("error" in started) {
    return NextResponse.json({ error: started.error }, { status: 500 });
  }
  jobId = started.id;
  return NextResponse.json({ ok: true, jobId });
}
