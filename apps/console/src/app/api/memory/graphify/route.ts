import path from "node:path";
import { NextResponse } from "next/server";
import { appendUsageEvent } from "@/core/toolsUsage";
import {
  graphifyCliInstalled,
  graphifyPublishStatus,
  graphifyStatus,
  pruneGraphifyPublic,
  syncGraphifyPublic,
} from "@/core/graphify";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/graphify - статус графа по каждой рабочей папке (+CLI,
 * публикация graph.html в public/graphify/<slug>/ - статика Next, iframe).
 */
export async function GET() {
  const { state, repoRoot } = await serverContext();
  const publicRoot = path.join(repoRoot, "apps", "console", "public", "graphify");
  const folders = await Promise.all(
    workspaceDirs(state).map(async (dir) => ({
      dir,
      name: path.basename(dir),
      enabled: state.workspaces.graphify.includes(dir),
      graph: await graphifyStatus(fsSignals, dir),
      published: await graphifyPublishStatus(fsSignals, dir, publicRoot),
    })),
  );
  // публикуем существующие графы и чистим устаревшие слаги
  const publishedSlugs: string[] = [];
  for (const folder of folders) {
    if (folder.graph.exists) {
      const slug = await syncGraphifyPublic(folder.dir, publicRoot);
      if (slug) {
        publishedSlugs.push(slug);
        folder.published = { exists: true, generatedAt: new Date().toISOString(), slug };
      }
    }
  }
  await pruneGraphifyPublic(publicRoot, publishedSlugs);
  return NextResponse.json({ cli: { installed: graphifyCliInstalled() }, folders });
}

/** POST /api/memory/graphify {tool, action, detail} - событие использования (build/graph). */
export async function POST(request: Request) {
  const { repoRoot } = await serverContext();
  const body = (await request.json().catch(() => null)) as { action?: string; detail?: string } | null;
  if (body?.action !== "build" && body?.action !== "graph") {
    return NextResponse.json({ error: "action: build | graph" }, { status: 400 });
  }
  await appendUsageEvent(repoRoot, { tool: "graphify", action: body.action, detail: body.detail });
  return NextResponse.json({ ok: true });
}
