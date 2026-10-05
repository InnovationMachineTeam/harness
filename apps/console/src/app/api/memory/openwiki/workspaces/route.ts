import { NextResponse } from "next/server";
import {
  createWorkspace,
  deleteWorkspace,
  setActiveWorkspace,
  workspaceOverview,
} from "@/core/openwikiWorkspaces";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/openwiki/workspaces
 * Мультирепозиторные вики-воркспейсы openwiki: состав и активность по каждой
 * рабочей папке (реестр ~/.openwiki/wiki-workspaces.json; `openwiki link` -
 * интерактивный TUI, поэтому состав правит консоль).
 */
export async function GET() {
  const ctx = await serverContext();
  const overview = await workspaceOverview(workspaceDirs(ctx.state));
  const workspaces = overview.registry.workspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    wikis: ws.wikis
      .map((id) => overview.registry.wikis.find((w) => w.id === id))
      .filter((w): w is NonNullable<typeof w> => Boolean(w))
      .map((w) => w.name),
  }));
  return NextResponse.json({ workspaces, folders: overview.folders });
}

/**
 * POST /api/memory/openwiki/workspaces {action, ...}
 * - {action:"link", name, dirs} - создать воркспейс из ≥2 папок с собранной вики;
 * - {action:"use", dir, workspaceId} / {action:"clear", dir} - активный воркспейс;
 * - {action:"delete", workspaceId} - удалить воркспейс (вики остаются).
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    name?: string;
    dirs?: string[];
    dir?: string;
    workspaceId?: string;
  } | null;
  const dirs = workspaceDirs(ctx.state);
  const inWorkspaces = (dir?: string): boolean => Boolean(dir && dirs.includes(dir));

  switch (body?.action) {
    case "link": {
      const picked = (body.dirs ?? []).filter(inWorkspaces);
      const result = await createWorkspace(body.name ?? "", picked);
      return NextResponse.json(
        result.ok ? { ok: true } : { error: result.error },
        { status: result.ok ? 200 : 400 },
      );
    }
    case "use": {
      if (!inWorkspaces(body.dir) || !body.workspaceId) {
        return NextResponse.json({ error: "нужны dir из рабочих папок и workspaceId" }, { status: 400 });
      }
      const result = await setActiveWorkspace(body.dir!, body.workspaceId);
      return NextResponse.json(
        result.ok ? { ok: true } : { error: result.error },
        { status: result.ok ? 200 : 400 },
      );
    }
    case "clear": {
      if (!inWorkspaces(body.dir)) {
        return NextResponse.json({ error: "нужен dir из рабочих папок" }, { status: 400 });
      }
      const result = await setActiveWorkspace(body.dir!, null);
      return NextResponse.json(
        result.ok ? { ok: true } : { error: result.error },
        { status: result.ok ? 200 : 400 },
      );
    }
    case "delete": {
      if (!body.workspaceId) return NextResponse.json({ error: "нужен workspaceId" }, { status: 400 });
      const result = await deleteWorkspace(body.workspaceId);
      return NextResponse.json(
        result.ok ? { ok: true } : { error: result.error },
        { status: result.ok ? 200 : 400 },
      );
    }
    default:
      return NextResponse.json({ error: "неизвестное действие" }, { status: 400 });
  }
}
