import path from "node:path";
import { NextResponse } from "next/server";
import {
  graphifyAllInOneDir,
  graphifyCliInstalled,
  graphifyOutDir,
  graphifyWorkspaceDir,
  graphifyWorkspaceNames,
  readGraphifyBuildMeta,
  readGraphifyWikiMeta,
  startGraphifyMergeBuild,
  startGraphifyWikiBuild,
} from "@/core/graphify";
import { processAlive } from "@/core/memory";
import { appendUsageEvent } from "@/core/toolsUsage";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/graphify/merge {wiki?: boolean}
 * Без wiki: объединить собранные графы включённых рабочих папок в All-in-One -
 * `graphify merge-graphs <источники> --out
 * graphify-out/all-in-one/graphify-out/graph.json && graphify cluster-only
 * graphify-out/all-in-one --no-label`. Источники - собранные
 * graphify/<имя>/graphify-out/graph.json; несобранные папки пропускаются.
 * {wiki: true}: единая wiki из объединённого графа (`graphify export wiki`).
 * Процессы отвязанные, лог - graphify-out/.console-build.log /
 * .console-wiki.log каталога all-in-one.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { wiki?: boolean } | null;
  if (!graphifyCliInstalled()) {
    return NextResponse.json(
      { error: "graphify CLI не установлен - Настройки → Инструменты или uv tool install graphifyy" },
      { status: 400 },
    );
  }
  const dir = graphifyAllInOneDir(ctx.repoRoot);
  const mergeMeta = await readGraphifyBuildMeta(dir);
  if (mergeMeta && processAlive(mergeMeta.pid)) {
    return NextResponse.json({ error: "сборка All-in-One уже идёт" }, { status: 409 });
  }
  if (body?.wiki) {
    if (!(await fsSignals.exists(path.join(graphifyOutDir(dir), "graph.json")))) {
      return NextResponse.json({ error: "объединённый граф ещё не собран - сначала \"Собрать\"" }, { status: 400 });
    }
    const wikiMeta = await readGraphifyWikiMeta(dir);
    if (wikiMeta && processAlive(wikiMeta.pid)) {
      return NextResponse.json({ error: "сборка wiki уже идёт" }, { status: 409 });
    }
    const result = await startGraphifyWikiBuild({ storeDir: dir, repoRoot: ctx.repoRoot });
    if (result.ok) {
      await appendUsageEvent(ctx.repoRoot, { tool: "graphify", action: "graph", detail: "wiki: all-in-one" });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  const dirs = workspaceDirs(ctx.state);
  const names = graphifyWorkspaceNames(dirs);
  const sources: string[] = [];
  for (const workspace of dirs) {
    if (!ctx.state.workspaces.graphify.includes(workspace)) continue;
    const name = names.get(workspace) ?? path.basename(workspace);
    const graphJson = path.join(graphifyOutDir(graphifyWorkspaceDir(ctx.repoRoot, name)), "graph.json");
    if (await fsSignals.exists(graphJson)) sources.push(path.relative(ctx.repoRoot, graphJson) || graphJson);
  }
  if (sources.length === 0) {
    return NextResponse.json({ error: "нет собранных графов рабочих папок - сначала \"Собрать\" граф папки" }, { status: 400 });
  }
  const result = await startGraphifyMergeBuild({ sources, repoRoot: ctx.repoRoot, task: { model: null } });
  if (result.ok) {
    await appendUsageEvent(ctx.repoRoot, { tool: "graphify", action: "build", detail: `merge (${sources.length} ист.)` });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
