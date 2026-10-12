import { NextResponse } from "next/server";
import { startDashboard } from "@/core/dashboards";
import { serviceExtraEnv } from "@/core/lightragLlm";
import { readPackageManagerPref, TOOL_COMBOS, toolsStatus, TOOL_RUNTIMES, writePackageManagerPref, writeToolsEnv } from "@/core/tools";
import { appendUsageEvent } from "@/core/toolsUsage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Троттлинг попыток lazy-autostart (GET дергается часто - опросом UI). */
const lastAutostartAttempt = new Map<string, number>();
const AUTOSTART_RETRY_MS = 30_000;

/**
 * GET /api/tools - статусы инструментов (система/per-runtime/MCP) + выбранный
 * менеджер пакетов. Заодно синхронизирует tools.env с внешними установками и
 * запускает дашборды с включённым автозапуском (если порт не отвечает; повторные
 * попытки - не чаще раза в 30 с).
 */
export async function GET() {
  const ctx = await serverContext();
  const pm = await readPackageManagerPref(ctx.repoRoot);
  await writeToolsEnv(ctx.repoRoot, ctx.state).catch(() => {
    /* env-файл не критичен для ответа */
  });

  const status = await toolsStatus(ctx.repoRoot, ctx.state, pm);
  const now = Date.now();
  for (const tool of status) {
    if (!tool.dashboard || !tool.dashboard.autostart || tool.dashboard.live) continue;
    const last = lastAutostartAttempt.get(tool.id) ?? 0;
    if (now - last < AUTOSTART_RETRY_MS) continue;
    lastAutostartAttempt.set(tool.id, now);
    await startDashboard(ctx.repoRoot, tool.id, serviceExtraEnv(tool.id, ctx.state)).catch(() => {
      /* доступность покажет следующий прогон probes */
    });
  }

  // Связки памяти (Знание → Связки): члены со статусом из toolsStatus
  const combos = TOOL_COMBOS.map((combo) => ({
    ...combo,
    tools: combo.toolIds
      .map((id) => status.find((tool) => tool.id === id))
      .filter((tool) => tool !== undefined)
      .map((tool) => ({
        id: tool.id,
        title: tool.title,
        state: tool.state,
        mcp: tool.mcp,
        dashboard: tool.dashboard
          ? { url: tool.dashboard.url, label: tool.dashboard.label, live: tool.dashboard.live, managedPid: tool.dashboard.managedPid, autostart: tool.dashboard.autostart }
          : null,
      })),
  }));

  return NextResponse.json({
    tools: status,
    combos,
    packageManager: pm,
    runtimes: TOOL_RUNTIMES,
  });
}

/** PUT /api/tools {packageManager: "bun"|"npm"} - выбор менеджера глобальных npm-пакетов. */
export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { packageManager?: unknown } | null;
  if (body?.packageManager !== "bun" && body?.packageManager !== "npm") {
    return NextResponse.json({ error: "packageManager: bun | npm" }, { status: 400 });
  }
  const pm = body.packageManager;
  await writePackageManagerPref(ctx.repoRoot, pm);
  await appendUsageEvent(ctx.repoRoot, { tool: "pm", action: "pm", detail: pm });
  return NextResponse.json({ ok: true, packageManager: pm });
}
