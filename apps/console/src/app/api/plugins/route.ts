import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { syncMcp } from "@/core/mcp/sync";
import {
  BUILTIN_PLUGINS,
  fetchMarketplacePlugins,
  installPlugin,
  setPluginEnabled,
  uninstallPlugin,
  type PluginDef,
} from "@/core/plugins";
import type { ConsoleState } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/plugins - установленные плагины + builtin-каталог + каталоги marketplace. */
export async function GET() {
  const { state } = await serverContext();
  const catalogs: { name: string; url: string | null; plugins: PluginDef[]; error?: string }[] = [
    { name: "builtin", url: null, plugins: BUILTIN_PLUGINS },
  ];
  for (const marketplace of state.plugins.marketplaces) {
    try {
      catalogs.push({ name: marketplace.name, url: marketplace.url, plugins: await fetchMarketplacePlugins(marketplace.url) });
    } catch (err) {
      catalogs.push({
        name: marketplace.name,
        url: marketplace.url,
        plugins: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return NextResponse.json({
    installed: Object.values(state.plugins.installed),
    marketplaces: state.plugins.marketplaces,
    catalogs,
  });
}

/** POST /api/plugins/install {plugin: PluginDef} - установить и включить. */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { plugin?: Partial<PluginDef> } | null;
  const raw = body?.plugin;
  if (!raw?.id || typeof raw.id !== "string") {
    return NextResponse.json({ error: "нужен plugin.id" }, { status: 400 });
  }
  // плагин ищем в доверенных каталогах (builtin + marketplaces), не в теле запроса
  const found = await findInCatalogs(ctx.state, raw.id);
  if (!found) return NextResponse.json({ error: `плагин не найден в каталогах: ${raw.id}` }, { status: 404 });
  installPlugin(ctx.state, found);
  const results = await syncMcp(ctx.repoRoot, ctx.state);
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, plugin: ctx.state.plugins.installed[raw.id], results: Object.values(results) });
}

/** PATCH /api/plugins {id, enabled} - включить/выключить (MCP в реестре). */
export async function PATCH(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { id?: string; enabled?: boolean } | null;
  const { id, enabled } = body ?? {};
  if (!id || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "нужны id и enabled" }, { status: 400 });
  }
  if (!setPluginEnabled(ctx.state, id, enabled)) {
    return NextResponse.json({ error: `плагин не найден: ${id}` }, { status: 404 });
  }
  const results = await syncMcp(ctx.repoRoot, ctx.state);
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, results: Object.values(results) });
}

/** DELETE /api/plugins?id= - удалить (выключить и убрать запись). */
export async function DELETE(request: Request) {
  const ctx = await serverContext();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!uninstallPlugin(ctx.state, id)) {
    return NextResponse.json({ error: `плагин не найден: ${id}` }, { status: 404 });
  }
  const results = await syncMcp(ctx.repoRoot, ctx.state);
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, results: Object.values(results) });
}

async function findInCatalogs(state: ConsoleState, id: string): Promise<PluginDef | null> {
  const builtin = BUILTIN_PLUGINS.find((p) => p.id === id);
  if (builtin) return builtin;
  for (const marketplace of state.plugins.marketplaces) {
    try {
      const found = (await fetchMarketplacePlugins(marketplace.url)).find((p) => p.id === id);
      if (found) return found;
    } catch {
      /* недоступный маркетплейс пропускаем */
    }
  }
  return null;
}
