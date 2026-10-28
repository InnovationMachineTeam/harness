import { mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  appendReaAnalysis,
  buildReaAnalysisSteps,
  buildReaDoctorSteps,
  buildReaEnvBuildSteps,
  newReaAnalysisId,
  reaEnvSourcesDir,
  reaEvidenceDir,
  reaOperationById,
  updateReaAnalysis,
  validateReaEnvDir,
  validateReaEnvName,
  validateReaTarget,
} from "@/core/rea";
import { startToolJob, type ToolJobStep } from "@/core/toolJobs";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/rea/run {action: "analysis"|"environment"|"doctor", ...}
 * Запуск операции rea как job'а инструментов (терминал - SSE /api/tools/job).
 * analysis: {operation, target, provider?}; environment: {harPath, name} -
 * сборка среды в sources/<имя>; doctor - диагностика без записи в реестр.
 * Анализ и среда пишут stdout шага в evidence-файл .agents/console/rea/evidence/.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "analysis" | "environment" | "doctor";
        operation?: string;
        target?: string;
        provider?: string;
        harPath?: string;
        name?: string;
      }
    | null;
  const action = body?.action;
  if (action !== "analysis" && action !== "environment" && action !== "doctor") {
    return NextResponse.json({ error: "действие должно быть analysis, environment или doctor" }, { status: 400 });
  }

  if (action === "doctor") {
    const doctorJob = startToolJob({
      toolId: "rea",
      action: "doctor",
      steps: buildReaDoctorSteps(),
      defaultCwd: ctx.repoRoot,
    });
    if ("error" in doctorJob) return NextResponse.json({ error: doctorJob.error }, { status: 500 });
    return NextResponse.json({ jobId: doctorJob.id });
  }

  const id = newReaAnalysisId();
  const evidenceFile = path.join(reaEvidenceDir(ctx.repoRoot), `${id}.json`);
  await mkdir(reaEvidenceDir(ctx.repoRoot), { recursive: true });

  if (action === "analysis") {
    const operation = reaOperationById(body?.operation ?? "");
    if (!operation) return NextResponse.json({ error: "неизвестная операция rea" }, { status: 400 });
    const target = validateReaTarget(body?.target);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
    const provider = typeof body?.provider === "string" && body.provider ? body.provider : undefined;
    const steps = buildReaAnalysisSteps({ operation, target: target.value, provider, evidenceFile });
    const jobId = await runRegistered(ctx.repoRoot, id, {
      action: "analysis",
      operation: operation.id,
      target: target.value,
      ...(provider ? { provider } : {}),
      steps,
      evidenceFile,
    });
    return NextResponse.json({ jobId, analysisId: id });
  }

  // environment: HAR или capture-Evidence → бандл среды в sources/<имя>
  const har = validateReaTarget(body?.harPath);
  if (!har.ok) return NextResponse.json({ error: `захват: ${har.error}` }, { status: 400 });
  const name = validateReaEnvName(body?.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
  const sourcesDir = reaEnvSourcesDir(ctx.repoRoot, name.value);
  const dirCheck = validateReaEnvDir(sourcesDir);
  if (!dirCheck.ok) return NextResponse.json({ error: dirCheck.error }, { status: 400 });
  const steps = buildReaEnvBuildSteps({ harPath: har.value, name: name.value, sourcesDir, evidenceFile });
  const jobId = await runRegistered(ctx.repoRoot, id, {
    action: "environment",
    operation: "environment-build",
    target: har.value,
    name: name.value,
    sourcesDir,
    steps,
    evidenceFile,
  });
  return NextResponse.json({ jobId, analysisId: id, sourcesDir });
}

/** Реестр (running) → job → onDone обновляет статус записи. */
async function runRegistered(
  repoRoot: string,
  id: string,
  entry: {
    action: "analysis" | "environment";
    operation: string;
    target: string;
    provider?: string;
    name?: string;
    sourcesDir?: string;
    steps: ToolJobStep[];
    evidenceFile: string;
  },
): Promise<string> {
  await appendReaAnalysis(repoRoot, {
    id,
    at: new Date().toISOString(),
    action: entry.action,
    operation: entry.operation,
    target: entry.target,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.name ? { name: entry.name } : {}),
    ...(entry.sourcesDir ? { sourcesDir: entry.sourcesDir } : {}),
    jobId: "",
    status: "running",
    exitCode: null,
    evidenceFile: entry.evidenceFile,
  });
  const job = startToolJob({
    toolId: "rea",
    action: entry.action,
    steps: entry.steps,
    defaultCwd: repoRoot,
    onDone: (exitCode) => {
      void updateReaAnalysis(repoRoot, id, { status: exitCode === 0 ? "ok" : "failed", exitCode });
    },
  });
  if ("error" in job) {
    await updateReaAnalysis(repoRoot, id, { status: "failed", exitCode: null });
    throw new Error(job.error);
  }
  await updateReaAnalysis(repoRoot, id, { jobId: job.id });
  return job.id;
}
