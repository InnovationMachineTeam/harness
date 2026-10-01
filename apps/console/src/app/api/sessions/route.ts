import { NextResponse } from "next/server";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions?runtime=&dir=&id=
 * Без id - список сессий (dir фильтрует по рабочей папке), с id - детали/превью.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const url = new URL(request.url);
  const runtime = url.searchParams.get("runtime");
  const id = url.searchParams.get("id");
  const dir = url.searchParams.get("dir");
  if (!runtime) return NextResponse.json({ error: "укажите ?runtime=" }, { status: 400 });

  const adapter = ctx.adapters[runtime];
  if (!adapter) return NextResponse.json({ error: `неизвестный рантайм: ${runtime}` }, { status: 404 });

  const dirs = dir ? [dir] : workspaceDirs(ctx.state);
  const probeCtx = {
    repoRoot: ctx.repoRoot,
    home: (await import("node:os")).homedir(),
    fs: (await import("@/lib/signals/fs")).fsSignals,
    workspaces: workspaceDirs(ctx.state),
  };

  if (!adapter.listSessions || !adapter.getSession) {
    return NextResponse.json({ supported: false, sessions: [], detail: null });
  }

  if (id) {
    const detail = await adapter.getSession(probeCtx, id);
    if (!detail) return NextResponse.json({ error: "сессия не найдена" }, { status: 404 });
    return NextResponse.json({ supported: true, detail });
  }

  const sessions = await adapter.listSessions(probeCtx, dirs);
  return NextResponse.json({ supported: true, sessions });
}
