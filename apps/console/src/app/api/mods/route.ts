import { NextResponse } from "next/server";
import {
  MOD_CATALOG,
  claudeCliAvailable,
  installMod,
  reconcileMods,
  setModEnabled,
  uninstallMod,
} from "@/core/mods";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/mods - каталог модов + статусы зеркала; ?reconcile=1 сверяет статусы с CLI claude plugin. */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const cliAvailable = claudeCliAvailable();
  let reconciled = false;
  let reconcileError: string | undefined;
  if (cliAvailable && new URL(request.url).searchParams.get("reconcile") === "1") {
    try {
      await reconcileMods(ctx.state);
      await ctx.saveState();
      reconciled = true;
    } catch (err) {
      reconcileError = err instanceof Error ? err.message : String(err);
    }
  }
  return NextResponse.json({
    cliAvailable,
    reconciled,
    reconcileError,
    mods: MOD_CATALOG.map((mod) => ({
      ...mod,
      installed: Boolean(ctx.state.mods.installed[mod.id]),
      enabled: ctx.state.mods.installed[mod.id]?.enabled ?? false,
    })),
  });
}

/** POST /api/mods {id} - установить мод (marketplace add + plugin install). */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: "нужен id" }, { status: 400 });
  if (!claudeCliAvailable()) {
    return NextResponse.json({ error: "CLI claude не найден в PATH - установка модов недоступна" }, { status: 400 });
  }
  const result = await installMod(ctx.repoRoot, ctx.state, body.id);
  if (!result.ok) return NextResponse.json({ error: result.error, output: result.output }, { status: 400 });
  await ctx.saveState();
  return NextResponse.json({ ok: true, output: result.output });
}

/** PATCH /api/mods {id, enabled} - включить/выключить установленный мод. */
export async function PATCH(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { id?: string; enabled?: boolean } | null;
  const { id, enabled } = body ?? {};
  if (!id || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "нужны id и enabled" }, { status: 400 });
  }
  if (!claudeCliAvailable()) {
    return NextResponse.json({ error: "CLI claude не найден в PATH - переключение модов недоступно" }, { status: 400 });
  }
  const result = await setModEnabled(ctx.state, id, enabled);
  if (!result.ok) return NextResponse.json({ error: result.error, output: result.output }, { status: 400 });
  await ctx.saveState();
  return NextResponse.json({ ok: true, output: result.output });
}

/** DELETE /api/mods?id= - удалить мод (plugin uninstall; marketplace остаётся). */
export async function DELETE(request: Request) {
  const ctx = await serverContext();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "нужен id" }, { status: 400 });
  if (!claudeCliAvailable()) {
    return NextResponse.json({ error: "CLI claude не найден в PATH - удаление модов недоступно" }, { status: 400 });
  }
  const result = await uninstallMod(ctx.state, id);
  if (!result.ok) return NextResponse.json({ error: result.error, output: result.output }, { status: 400 });
  await ctx.saveState();
  return NextResponse.json({ ok: true, output: result.output });
}
