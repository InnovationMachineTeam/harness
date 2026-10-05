import path from "node:path";
import { NextResponse } from "next/server";
import {
  graphifyOutDir,
  graphifySlug,
  graphifyWorkspaceDir,
  graphifyWorkspaceNames,
  pruneGraphifyPublic,
  syncGraphifyPublic,
} from "@/core/graphify";
import { appendUsageEvent } from "@/core/toolsUsage";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/graphify/graph {dir}
 * Опубликовать собранный граф рабочей папки (graphify-out/graph.html из
 * хранилища воркспейсов → public/graphify/<slug>/index.html) для встраивания
 * iframe с того же origin. Сам graph.html генерирует сборка (extract +
 * cluster-only).
 */
export async function POST(request: Request) {
  const { state, repoRoot } = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  const dirs = workspaceDirs(state);
  if (!dir || !dirs.includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  const names = graphifyWorkspaceNames(dirs);
  const storeDir = graphifyWorkspaceDir(repoRoot, names.get(dir) ?? path.basename(dir));
  if (!(await fsSignals.exists(graphifyOutDir(storeDir)))) {
    return NextResponse.json({ error: "граф ещё не собран - сначала \"Собрать\"" }, { status: 400 });
  }
  const publicRoot = path.join(repoRoot, "apps", "console", "public", "graphify");
  const published = await syncGraphifyPublic(storeDir, publicRoot);
  if (!published) {
    return NextResponse.json({ error: "graph.html не найден - пересоберите граф" }, { status: 400 });
  }
  // активные слаги - от каталогов воркспейсов в хранилище (как в syncGraphifyPublic),
  // иначе prune удалит только что опубликованный граф
  await pruneGraphifyPublic(
    publicRoot,
    dirs.map((d) => graphifySlug(graphifyWorkspaceDir(repoRoot, names.get(d) ?? path.basename(d)))),
  );
  await appendUsageEvent(repoRoot, { tool: "graphify", action: "graph", detail: dir });
  return NextResponse.json({ ok: true, detail: "граф опубликован", slug: published.slug });
}
