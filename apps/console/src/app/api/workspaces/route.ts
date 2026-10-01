import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { validateWorkspaces } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/workspaces - обязательная + дополнительные папки (с проверкой существования). */
export async function GET() {
  const { state } = await serverContext();
  const check = async (dir: string) => {
    try {
      await stat(dir);
      return true;
    } catch {
      return false;
    }
  };
  return NextResponse.json({
    mandatory: { path: state.workspaces.mandatory, exists: await check(state.workspaces.mandatory) },
    additional: await Promise.all(
      state.workspaces.additional.map(async (p) => ({ path: p, exists: await check(p) })),
    ),
    openwiki: state.workspaces.openwiki,
    graphify: state.workspaces.graphify,
    docs: state.workspaces.docs,
  });
}

/** PUT /api/workspaces - обновить список; обязательная папка обязательна (≥1). */
export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { mandatory?: string; additional?: string[]; openwiki?: string[]; graphify?: string[]; docs?: string[] }
    | null;
  const validation = validateWorkspaces({
    mandatory: body?.mandatory ?? ctx.state.workspaces.mandatory,
    additional: body?.additional ?? ctx.state.workspaces.additional,
    openwiki: body?.openwiki ?? ctx.state.workspaces.openwiki,
    graphify: body?.graphify ?? ctx.state.workspaces.graphify,
    docs: body?.docs ?? ctx.state.workspaces.docs,
  });
  if (!validation.ok || !validation.value) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }
  for (const dir of [validation.value.mandatory, ...validation.value.additional]) {
    try {
      await stat(dir);
    } catch {
      return NextResponse.json({ errors: [`каталог не существует: ${dir}`] }, { status: 400 });
    }
  }
  ctx.state.workspaces = validation.value;
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, workspaces: validation.value });
}
