import path from "node:path";
import { NextResponse } from "next/server";
import {
  openwikiCli,
  pruneVisualizerPublic,
  syncVisualizerPublic,
  visualizerStatus,
  wikiStatus,
} from "@/core/memory";
import { workspaceDirs, mandatoryWorkspace } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/** GET /api/memory/openwiki - статус вики по каждой рабочей папке (+CLI, визуализатор). */
export async function GET() {
  const { state, repoRoot } = await serverContext();
  const [cli, folders] = await Promise.all([
    openwikiCli(),
    Promise.all(
      workspaceDirs(state).map(async (dir) => ({
        dir,
        name: path.basename(dir),
        enabled: state.workspaces.openwiki.includes(dir),
        wiki: await wikiStatus(fsSignals, dir),
        visualizer: await visualizerStatus(fsSignals, dir),
      })),
    ),
  ]);
  // публикуем экспорт в public/ (статика Next) и чистим устаревшие слаги
  const publicRoot = path.join(repoRoot, "apps", "console", "public", "visualizers");
  const publishedSlugs: string[] = [];
  for (const folder of folders) {
    if (folder.visualizer.exists) {
      const slug = await syncVisualizerPublic(folder.dir, publicRoot);
      if (slug) publishedSlugs.push(slug);
    }
  }
  await pruneVisualizerPublic(publicRoot, publishedSlugs);
  return NextResponse.json({ cli, folders, mandatoryWorkspace: mandatoryWorkspace(state) });
}
