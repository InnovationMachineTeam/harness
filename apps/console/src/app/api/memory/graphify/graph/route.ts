import path from "node:path";
import { NextResponse } from "next/server";
import { graphifyOutDir, graphifySlug, pruneGraphifyPublic, syncGraphifyPublic } from "@/core/graphify";
import { appendUsageEvent } from "@/core/toolsUsage";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/graphify/graph {dir}
 * Опубликовать собранный граф (graphify-out/graph.html → public/graphify/<slug>/index.html)
 * для встраивания iframe с того же origin. Сам graph.html генерирует сборка.
 */
export async function POST(request: Request) {
  const { state, repoRoot } = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  if (!dir || !workspaceDirs(state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  if (!(await fsSignals.exists(graphifyOutDir(dir)))) {
    return NextResponse.json({ error: "граф ещё не собран - сначала \"Собрать\"" }, { status: 400 });
  }
  const publicRoot = path.join(repoRoot, "apps", "console", "public", "graphify");
  const slug = await syncGraphifyPublic(dir, publicRoot);
  if (!slug) {
    return NextResponse.json({ error: "graph.html не найден - пересоберите граф" }, { status: 400 });
  }
  const dirs = workspaceDirs(state);
  await pruneGraphifyPublic(
    publicRoot,
    dirs.map((d) => graphifySlug(d)),
  );
  await appendUsageEvent(repoRoot, { tool: "graphify", action: "graph", detail: dir });
  return NextResponse.json({ ok: true, detail: "граф опубликован", slug });
}
