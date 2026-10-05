import path from "node:path";
import { NextResponse } from "next/server";
import {
  graphifyWorkspaceDir,
  graphifyWorkspaceNames,
  graphifyWikiStatus,
  readGraphifyBuildMeta,
  startGraphifyWikiBuild,
} from "@/core/graphify";
import { processAlive } from "@/core/memory";
import { appendUsageEvent } from "@/core/toolsUsage";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/graphify/wiki {dir}
 * Собрать wiki из графа рабочей папки: `graphify export wiki --graph
 * <хранилище>/<имя>/graphify-out/graph.json` - статьи markdown в
 * graphify-out/wiki/ (index.md - точка входа). Отвязанный процесс, лог
 * .console-wiki.log.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  const dirs = workspaceDirs(ctx.state);
  if (!dir || !dirs.includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  const name = graphifyWorkspaceNames(dirs).get(dir) ?? path.basename(dir);
  const storeDir = graphifyWorkspaceDir(ctx.repoRoot, name);
  const graphMeta = await readGraphifyBuildMeta(storeDir);
  if (graphMeta && processAlive(graphMeta.pid)) {
    return NextResponse.json({ error: "идёт сборка графа - wiki собирается после неё" }, { status: 409 });
  }
  const status = await graphifyWikiStatus(fsSignals, storeDir);
  if (status.build.running) {
    return NextResponse.json({ error: "сборка wiki уже идёт" }, { status: 409 });
  }
  if (!status.exists && !(await fsSignals.exists(path.join(storeDir, "graphify-out", "graph.json")))) {
    return NextResponse.json({ error: "граф ещё не собран - сначала \"Собрать\"" }, { status: 400 });
  }
  const result = await startGraphifyWikiBuild({ storeDir, repoRoot: ctx.repoRoot });
  if (result.ok) {
    await appendUsageEvent(ctx.repoRoot, { tool: "graphify", action: "graph", detail: `wiki: ${dir}` });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
