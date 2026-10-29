import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import {
  buildSystemInstallSteps,
  probeSetupDeps,
  probeSystemInfo,
  resetSetupProbeCache,
  sanitizeSystemTargets,
} from "@/core/setupWizard";
import { startToolJob } from "@/core/toolJobs";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/setup/system - установка недостающих системных компонентов
 * (шаг визарда): {targets: ("bun" | "node" | "workspace")[]}. Цепочка шагов -
 * buildSystemInstallSteps (повторяет setup.sh; интерактивные случаи - отказ с
 * подсказкой terminal-скрипта). Выполняется job'ом, вывод - SSE
 * /api/tools/job. По завершении сбрасывается кеш детекта зависимостей.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { targets?: unknown } | null;
  const targets = sanitizeSystemTargets(body?.targets);
  if (targets.length === 0) {
    return NextResponse.json({ error: "targets: укажите bun, node или workspace" }, { status: 400 });
  }
  const deps = probeSetupDeps();
  const built = buildSystemInstallSteps({
    targets,
    system: probeSystemInfo(),
    repoRoot: ctx.repoRoot,
    deps: {
      bunInstalled: deps.find((dep) => dep.id === "bun")?.installed === true,
      nodeInstalled: deps.find((dep) => dep.id === "node")?.installed === true,
      nodeVersion: deps.find((dep) => dep.id === "node")?.version ?? null,
    },
  });
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
  const job = startToolJob({
    toolId: "setup",
    action: "system-install",
    steps: built.steps,
    defaultCwd: ctx.repoRoot,
    onDone: () => resetSetupProbeCache(),
  });
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  return NextResponse.json({ ok: true, jobId: job.id });
}
