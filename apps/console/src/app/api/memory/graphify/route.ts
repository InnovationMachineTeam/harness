import path from "node:path";
import { NextResponse } from "next/server";
import { appendUsageEvent } from "@/core/toolsUsage";
import {
  graphifyCliInstalled,
  graphifyPublishStatus,
  graphifyStatus,
  graphifyStoreRoot,
  graphifyWorkspaceDir,
  graphifyWorkspaceNames,
  graphifyWikiStatus,
  graphifyWikiTree,
  pruneGraphifyPublic,
  syncGraphifyPublic,
} from "@/core/graphify";
import { mandatoryWorkspace, workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/graphify - статус графов по каждой рабочей папке: граф
 * собирается в хранилище воркспейсов <repoRoot>/graphify/<имя>/graphify-out
 * (имя - basename папки), публикация graph.html - в public/graphify/<slug>/
 * (статика Next, iframe). Для собранной wiki отдаётся дерево статей
 * (просмотр во вкладке Graphify).
 */
export async function GET() {
  const { state, repoRoot } = await serverContext();
  const publicRoot = path.join(repoRoot, "apps", "console", "public", "graphify");
  const dirs = workspaceDirs(state);
  const names = graphifyWorkspaceNames(dirs);
  const folders = await Promise.all(
    dirs.map(async (dir) => {
      const name = names.get(dir) ?? path.basename(dir);
      const storeDir = graphifyWorkspaceDir(repoRoot, name);
      return {
        dir,
        name,
        workspace: path.relative(repoRoot, storeDir) || storeDir,
        enabled: state.workspaces.graphify.includes(dir),
        graph: await graphifyStatus(fsSignals, storeDir),
        wiki: { ...(await graphifyWikiStatus(fsSignals, storeDir)), tree: await graphifyWikiTree(fsSignals, storeDir) },
        // слаг публикации считается от каталога воркспейса в хранилище
        published: await graphifyPublishStatus(fsSignals, storeDir, publicRoot),
      };
    }),
  );
  // публикуем существующие графы и чистим устаревшие слаги
  const publishedSlugs: string[] = [];
  for (const folder of folders) {
    if (folder.graph.exists) {
      const storeDir = graphifyWorkspaceDir(repoRoot, folder.name);
      const published = await syncGraphifyPublic(storeDir, publicRoot);
      if (published) {
        publishedSlugs.push(published.slug);
        folder.published = { exists: true, ...published };
      }
    }
  }
  await pruneGraphifyPublic(publicRoot, publishedSlugs);
  return NextResponse.json({
    cli: { installed: graphifyCliInstalled() },
    store: path.relative(repoRoot, graphifyStoreRoot(repoRoot)) || graphifyStoreRoot(repoRoot),
    folders,
    mandatoryWorkspace: mandatoryWorkspace(state),
  });
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
