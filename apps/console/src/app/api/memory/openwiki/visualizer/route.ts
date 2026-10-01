import path from "node:path";
import { NextResponse } from "next/server";
import {
  exportVisualizer,
  openwikiCli,
  pruneVisualizerPublic,
  syncVisualizerPublic,
  visualizerSlug,
  wikiDir,
} from "@/core/memory";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/openwiki/visualizer {dir}
 * Сгенерировать статический визуализатор (`openwiki visualize openwiki --export`)
 * для собранной вики рабочей папки и опубликовать его в public/visualizers/<slug>/
 * - Next раздаёт файлы статикой, iframe строит граф с того же origin.
 * Локальная и мгновенная генерация, без LLM.
 */
export async function POST(request: Request) {
  const { state, repoRoot } = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  if (!dir || !workspaceDirs(state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  const cli = await openwikiCli();
  if (!cli.installed) {
    return NextResponse.json(
      { error: "openwiki CLI не установлен: npm install -g openwiki" },
      { status: 400 },
    );
  }
  if (!(await fsSignals.exists(wikiDir(dir)))) {
    return NextResponse.json({ error: "вики ещё не собрана - сначала \"Собрать\"" }, { status: 400 });
  }
  const result = exportVisualizer(dir);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  const publicRoot = path.join(repoRoot, "apps", "console", "public", "visualizers");
  const slug = await syncVisualizerPublic(dir, publicRoot);
  const dirs = workspaceDirs(state);
  await pruneVisualizerPublic(
    publicRoot,
    dirs.map((d) => visualizerSlug(d)),
  );
  return NextResponse.json({ ...result, slug }, { status: 200 });
}
