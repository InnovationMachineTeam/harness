import { homedir } from "node:os";
import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { serviceExtraEnv } from "@/core/lightragLlm";
import { runLifecycleHook } from "@/core/lifecycleHooks";
import { syncMcp } from "@/core/mcp/sync";
import { mandatoryWorkspace } from "@/core/state";
import { startDashboard } from "@/core/dashboards";
import { buildInstallSteps, sanitizeToolParams } from "@/core/toolActions";
import { startToolJob, type ToolJobStep } from "@/core/toolJobs";
import { appendUsageEvent } from "@/core/toolsUsage";
import {
  readPackageManagerPref,
  toolById,
  toolRuntimeInstalled,
  writeToolsEnv,
  type ToolDef,
} from "@/core/tools";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/setup/tools - пакетная установка инструментов консоли (шаг
 * визарда): {toolIds: string[], params?}. Цепочка - buildInstallSteps каждого
 * инструмента (установленные системные пакеты пропускаются внутри сборки),
 * один job, вывод - SSE /api/tools/job. После успешного job'а - финализация
 * каждого инструмента (запись installed, MCP-пресет, lifecycle-хук), затем
 * общий sync/save/tools.env/usage и запуск сервисов (headroom).
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { toolIds?: unknown; params?: unknown } | null;
  const rawIds = Array.isArray(body?.toolIds) ? body?.toolIds.filter((id): id is string => typeof id === "string") : [];
  const ids = Array.from(new Set(rawIds));
  if (ids.length === 0) {
    return NextResponse.json({ error: "toolIds: список пуст" }, { status: 400 });
  }
  const defs: ToolDef[] = [];
  for (const id of ids) {
    const def = toolById(id);
    if (!def) return NextResponse.json({ error: `инструмент не найден: ${id}` }, { status: 404 });
    defs.push(def);
  }
  const params = sanitizeToolParams(body?.params);
  const platform = process.platform as NodeJS.Platform;
  const pm = await readPackageManagerPref(ctx.repoRoot);

  const steps: ToolJobStep[] = [];
  for (const def of defs) {
    const built = buildInstallSteps({
      def,
      runtimes: def.perRuntime?.supported ?? [],
      params,
      platform,
      packageManager: pm,
      state: ctx.state,
      repoRoot: ctx.repoRoot,
    });
    if (!built.ok) return NextResponse.json({ error: `${def.title}: ${built.error}` }, { status: 400 });
    for (const step of built.steps) {
      steps.push({ ...step, label: `${def.title}: ${step.label}` });
    }
  }

  const finalizeAll = async () => {
    for (const def of defs) {
      // в запись попадают и интеграции, обнаруженные маркерами на диске
      const detected = (def.perRuntime?.supported ?? []).filter((r) =>
        toolRuntimeInstalled(def, r, homedir(), ctx.repoRoot, ctx.state),
      );
      ctx.state.tools.installed[def.id] = {
        runtimes: detected,
        params,
        at: new Date().toISOString(),
        enabled: true,
      };
      const transport = def.mcpPreset?.(params);
      if (transport) {
        ctx.state.mcp.servers[def.id] = { name: def.id, transport, enabled: true };
      }
      await runLifecycleHook({
        repoRoot: ctx.repoRoot,
        workspace: mandatoryWorkspace(ctx.state),
        domain: "tool",
        name: def.id,
        op: "install",
        hooks: def.hooks,
      });
    }
    await syncMcp(ctx.repoRoot, ctx.state);
    await ctx.saveState();
    await writeToolsEnv(ctx.repoRoot, ctx.state);
    for (const def of defs) {
      await appendUsageEvent(ctx.repoRoot, { tool: def.id, action: "install", runtimes: def.perRuntime?.supported ?? [] });
      // сервис-инструменты (headroom): сервис стартует программно с пробой порта
      if (def.uninstallStopsDashboard === true && def.dashboard) {
        await startDashboard(ctx.repoRoot, def.id, serviceExtraEnv(def.id, ctx.state));
      }
    }
    invalidateDashboardCache();
  };

  if (steps.length === 0) {
    // внешних команд нет (CLI уже установлены, интеграции не требуются)
    await finalizeAll();
    return NextResponse.json({ ok: true, sync: true });
  }
  const job = startToolJob({
    toolId: "setup",
    action: "install-tools",
    steps,
    defaultCwd: ctx.repoRoot,
    onDone: (code) => {
      if (code !== 0) return;
      void finalizeAll();
    },
  });
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  return NextResponse.json({ ok: true, jobId: job.id });
}
