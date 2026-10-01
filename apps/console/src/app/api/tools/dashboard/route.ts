import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { startDashboard, stopDashboard } from "@/core/dashboards";
import { toolById } from "@/core/tools";
import { appendUsageEvent } from "@/core/toolsUsage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/tools/dashboard - управление дашбордом инструмента:
 *   {toolId, action: "start"}            - запустить автономный инстанс
 *   {toolId, action: "stop"}             - остановить инстанс, запущенный консолью
 *   {toolId, action: "autostart", enabled} - тоггл автозапуска: включение
 *     немедленно запускает инстанс (если порт не отвечает), выключение -
 *     останавливает консольный инстанс.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { toolId?: string; action?: string; enabled?: boolean }
    | null;
  const def = body?.toolId ? toolById(body.toolId) : undefined;
  if (!def?.dashboard) {
    return NextResponse.json({ error: `у инструмента нет дашборда: ${body?.toolId}` }, { status: 404 });
  }

  if (body?.action === "start") {
    const result = await startDashboard(ctx.repoRoot, def.id);
    if (result.ok) {
      await appendUsageEvent(ctx.repoRoot, { tool: def.id, action: "toggle", detail: `dashboard start :${result.port}` });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body?.action === "stop") {
    const result = await stopDashboard(ctx.repoRoot, def.id);
    invalidateDashboardCache();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body?.action === "autostart" && typeof body.enabled === "boolean") {
    const enabled = body.enabled;
    ctx.state.tools.autostart[def.id] = enabled;
    await ctx.saveState();
    let detail: string;
    if (enabled) {
      // включили, а сервер был выключен - запускаем немедленно
      const result = await startDashboard(ctx.repoRoot, def.id);
      detail = result.ok ? result.detail : result.error;
    } else {
      const result = await stopDashboard(ctx.repoRoot, def.id);
      detail = result.detail;
    }
    await appendUsageEvent(ctx.repoRoot, {
      tool: def.id,
      action: "toggle",
      detail: `autostart ${enabled ? "on" : "off"}`,
    });
    invalidateDashboardCache();
    return NextResponse.json({ ok: true, enabled, detail });
  }

  return NextResponse.json({ error: "action: start | stop | autostart" }, { status: 400 });
}
