import { homedir } from "node:os";
import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { stopDashboard } from "@/core/dashboards";
import { syncMcp } from "@/core/mcp/sync";
import { buildInstallSteps, buildInitSteps, buildUninstallSteps, cleanupAfterUninstall, sanitizeRuntimes, sanitizeToolParams } from "@/core/toolActions";
import { startToolJob, type ToolJobStep } from "@/core/toolJobs";
import { readPackageManagerPref, toolById, toolRuntimeInstalled, writeToolsEnv, type ToolRuntimeId } from "@/core/tools";
import { appendUsageEvent } from "@/core/toolsUsage";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/tools/action - жизненный цикл инструмента:
 *   install   {toolId, runtimes?, params?}
 *   uninstall {toolId, runtimes?}
 *   reinstall {toolId}
 *   toggle    {toolId, enabled}
 * С dryRun=true возвращает цепочку команд без запуска (превью в модалке).
 * Длинные операции выполняются job'ом (SSE /api/tools/job); MCP-тогглы
 * коротких инструментов применяются синхронно.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    toolId?: string;
    runtimes?: unknown;
    params?: unknown;
    enabled?: unknown;
    dryRun?: boolean;
    reinit?: boolean;
  } | null;

  const def = body?.toolId ? toolById(body.toolId) : undefined;
  if (!def) return NextResponse.json({ error: `инструмент не найден: ${body?.toolId}` }, { status: 404 });
  const action = body?.action ?? "";

  const pm = await readPackageManagerPref(ctx.repoRoot);
  const platform = process.platform as NodeJS.Platform;
  const finalize = async (detail: {
    runtimes: ToolRuntimeId[];
    params: ReturnType<typeof sanitizeToolParams>;
    enabled: boolean;
    action: "install" | "reinstall" | "toggle";
  }) => {
    // в запись попадают и интеграции, обнаруженные маркерами на диске
    // (внешние/ранние установки) - иначе uninstall/reinstall их пропустят
    const home = homedir();
    const detected = (def.perRuntime?.supported ?? []).filter((r) =>
      toolRuntimeInstalled(def, r, home, ctx.repoRoot, ctx.state),
    );
    const runtimes = Array.from(new Set([...detail.runtimes, ...detected]));
    ctx.state.tools.installed[def.id] = {
      runtimes,
      params: detail.params,
      at: new Date().toISOString(),
      enabled: detail.enabled,
    };
    const transport = def.mcpPreset?.(detail.params);
    if (transport) {
      ctx.state.mcp.servers[def.id] = { name: def.id, transport, enabled: true };
    }
    await syncMcp(ctx.repoRoot, ctx.state);
    await ctx.saveState();
    await writeToolsEnv(ctx.repoRoot, ctx.state);
    await appendUsageEvent(ctx.repoRoot, {
      tool: def.id,
      action: detail.action,
      runtimes: detail.runtimes,
    });
    invalidateDashboardCache();
  };

  if (action === "install" || action === "reinstall") {
    const record = ctx.state.tools.installed[def.id];
    const params = action === "reinstall" && record ? sanitizeToolParams(record.params) : sanitizeToolParams(body?.params);
    const runtimes =
      action === "reinstall" && record
        ? (record.runtimes as ToolRuntimeId[]).filter((r) => def.perRuntime?.supported.includes(r))
        : sanitizeRuntimes(def, body?.runtimes);
    const built = buildInstallSteps({ def, runtimes, params, platform, packageManager: pm, state: ctx.state });
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    const steps: ToolJobStep[] =
      action === "reinstall"
        ? [...buildUninstallSteps({ def, runtimes, params }), ...built.steps]
        : built.steps;
    if (body?.dryRun) return NextResponse.json({ ok: true, steps });
    if (steps.length === 0) {
      // внешних команд нет (CLI установлен, интеграции не требуются) -
      // синхронная регистрация MCP/записи без job'а
      await finalize({ runtimes, params, enabled: true, action });
      return NextResponse.json({ ok: true, sync: true });
    }
    const job = startToolJob({
      toolId: def.id,
      action,
      steps,
      defaultCwd: ctx.repoRoot,
      onDone: (code) => {
        if (code !== 0) return;
        void finalize({ runtimes, params, enabled: true, action });
      },
    });
    if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
    return NextResponse.json({ ok: true, jobId: job.id });
  }

  if (action === "uninstall") {
    const record = ctx.state.tools.installed[def.id];
    const params = record ? sanitizeToolParams(record.params) : sanitizeToolParams(body?.params);
    const home = homedir();
    const runtimes = Array.isArray(body?.runtimes) && body.runtimes.length
      ? sanitizeRuntimes(def, body?.runtimes)
      : ((record?.runtimes as ToolRuntimeId[] | undefined) ??
        (def.perRuntime?.supported ?? []).filter((r) => toolRuntimeInstalled(def, r, home, ctx.repoRoot, ctx.state)));
    const steps = buildUninstallSteps({ def, runtimes, params });
    if (body?.dryRun) return NextResponse.json({ ok: true, steps });
    const removeFinalize = async () => {
      // проектная зачистка (rtk project: CLI не умеет снимать сам)
      const cleaned = await cleanupAfterUninstall(ctx.repoRoot, def, params);
      // инструмент с сервисом (headroom): остановить инстанс и сбросить автозапуск
      if (def.uninstallStopsDashboard) {
        await stopDashboard(ctx.repoRoot, def.id);
        delete ctx.state.tools.autostart[def.id];
      }
      // MCP-сервер убираем только если его добавляла консоль (была запись);
      // сервер без записи ставили извне - реестр не изменяем.
      if (ctx.state.tools.installed[def.id]) delete ctx.state.mcp.servers[def.id];
      delete ctx.state.tools.installed[def.id];
      await syncMcp(ctx.repoRoot, ctx.state);
      await ctx.saveState();
      await writeToolsEnv(ctx.repoRoot, ctx.state);
      await appendUsageEvent(ctx.repoRoot, {
        tool: def.id,
        action: "uninstall",
        runtimes,
        detail: cleaned.length ? cleaned.join("; ") : undefined,
      });
      invalidateDashboardCache();
    };
    if (steps.length === 0) {
      await removeFinalize();
      return NextResponse.json({ ok: true, sync: true });
    }
    const job = startToolJob({
      toolId: def.id,
      action,
      steps,
      defaultCwd: ctx.repoRoot,
      onDone: (code) => {
        if (code !== 0) return;
        void removeFinalize();
      },
    });
    if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
    return NextResponse.json({ ok: true, jobId: job.id });
  }

  if (action === "init") {
    // инициализация/переинициализация по ВСЕМ рабочим папкам
    // (serena/codegraph/graphify): общий контекст из всех директорий
    const params = sanitizeToolParams(body?.params);
    const dirs = workspaceDirs(ctx.state);
    if (dirs.length === 0) {
      return NextResponse.json({ error: "рабочие папки не заданы" }, { status: 400 });
    }
    const steps = buildInitSteps(def, params, body?.reinit === true, dirs);
    if (body?.dryRun) return NextResponse.json({ ok: true, steps });
    if (steps.length === 0) {
      return NextResponse.json({ error: `у инструмента нет инициализации: ${def.id}` }, { status: 400 });
    }
    const job = startToolJob({
      toolId: def.id,
      action,
      steps,
      defaultCwd: ctx.repoRoot,
      onDone: (code) => {
        if (code !== 0) return;
        void (async () => {
          await writeToolsEnv(ctx.repoRoot, ctx.state);
          await appendUsageEvent(ctx.repoRoot, { tool: def.id, action: "index" });
          invalidateDashboardCache();
          // Serena кеширует список проектов на старте инстанса - после
          // индексации перезапускаем наш managed-инстанс, чтобы дашборд
          // увидел новые проекты (сторонние инстансы не затрагиваются)
          if (def.id === "serena") {
            const { restartDashboard } = await import("@/core/dashboards");
            await restartDashboard(ctx.repoRoot, "serena");
          }
        })();
      },
    });
    if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
    return NextResponse.json({ ok: true, jobId: job.id });
  }

  if (action === "toggle" && typeof body?.enabled === "boolean") {
    const enabled = body.enabled;
    const record = ctx.state.tools.installed[def.id];
    const params = record ? sanitizeToolParams(record.params) : sanitizeToolParams(body?.params);
    const home = homedir();
    const runtimes =
      (record?.runtimes as ToolRuntimeId[] | undefined) ??
      (def.perRuntime?.supported ?? []).filter((r) => toolRuntimeInstalled(def, r, home, ctx.repoRoot, ctx.state));

    // Короткие тогглы (только MCP, либо уже без интеграций) - синхронно.
    const usePerRuntime = !def.hasModes || params.mode !== "mcp";
    if (!usePerRuntime || runtimes.length === 0 || !def.perRuntime) {
      const transport = def.mcpPreset?.(params);
      if (transport) {
        ctx.state.mcp.servers[def.id] = { name: def.id, transport, enabled };
      } else if (ctx.state.mcp.servers[def.id]) {
        ctx.state.mcp.servers[def.id].enabled = enabled;
      }
      if (record) record.enabled = enabled;
      else
        ctx.state.tools.installed[def.id] = {
          runtimes,
          params,
          at: new Date().toISOString(),
          enabled,
        };
      await syncMcp(ctx.repoRoot, ctx.state);
      await ctx.saveState();
      await writeToolsEnv(ctx.repoRoot, ctx.state);
      await appendUsageEvent(ctx.repoRoot, { tool: def.id, action: "toggle", detail: enabled ? "on" : "off" });
      invalidateDashboardCache();
      return NextResponse.json({ ok: true, sync: true });
    }

    const built = enabled
      ? buildInstallSteps({ def, runtimes, params, platform, packageManager: pm, state: ctx.state })
      : ({ ok: true as const, steps: buildUninstallSteps({ def, runtimes, params }) });
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    if (body?.dryRun) return NextResponse.json({ ok: true, steps: built.steps });
    const job = startToolJob({
      toolId: def.id,
      action: "toggle",
      steps: built.steps,
      defaultCwd: ctx.repoRoot,
      onDone: (code) => {
        if (code !== 0) return;
        void finalize({ runtimes, params, enabled, action: "toggle" });
      },
    });
    if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
    return NextResponse.json({ ok: true, jobId: job.id });
  }

  return NextResponse.json({ error: `неизвестное действие: ${action}` }, { status: 400 });
}
