import { NextResponse } from "next/server";
import { buildDashboardData } from "@/core/registry";
import { findRepoRoot } from "@/core/repo";
import { loadConsoleState } from "@/core/state";
import { cachedDashboardData, invalidateDashboardCache } from "@/core/cache";
import { parseWindowParam, WINDOW_MS } from "@/lib/format";
import { serverContext } from "@/lib/server-context";
import { ADAPTERS } from "@/runtimes";

export const dynamic = "force-dynamic";

/** GET /api/runtimes?window=1h|24h|7d|all - срез статусов (кеш 5 с + дедупликация). */
export async function GET(request: Request) {
  const windowKey = parseWindowParam(new URL(request.url).searchParams.get("window"));
  const repoRoot = findRepoRoot();
  const data = await cachedDashboardData(`${repoRoot}|${windowKey}`, async () =>
    buildDashboardData({
      repoRoot,
      adapters: ADAPTERS,
      recentWindowMs: WINDOW_MS[windowKey],
      state: await loadConsoleState(repoRoot),
    }),
  );
  return NextResponse.json(data);
}
/** PATCH /api/runtimes - выбрать рантайм по умолчанию (★) для запуска промтов. */
export async function PATCH(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { defaultRuntime?: string | null } | null;
  const value = body?.defaultRuntime ?? null;
  if (value !== null && !ctx.adapters[value]) {
    return NextResponse.json({ error: `неизвестный рантайм: ${value}` }, { status: 400 });
  }
  ctx.state.defaultRuntime = value;
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, defaultRuntime: value });
}
