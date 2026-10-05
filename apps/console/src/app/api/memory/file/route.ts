import { homedir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { DOC_MATCH, readAllowedFile, readPolicy } from "@/core/memory";
import { graphifyOutDir, graphifyWorkspaceDir, graphifyWorkspaceNames } from "@/core/graphify";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/file?path=<абсолютный путь>
 * Содержимое файла из разрешённых корней памяти (доки рабочих папок, openwiki/,
 * memory-каталоги рантаймов, wiki Graphify в хранилище <repoRoot>/graphify/).
 * Произвольные пути и скрытые файлы запрещены.
 */
export async function GET(request: Request) {
  const { state, repoRoot } = await serverContext();
  const filePath = new URL(request.url).searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "нужен параметр path" }, { status: 400 });
  }
  const dirs = workspaceDirs(state);
  const names = graphifyWorkspaceNames(dirs);
  const graphifyWikiRoots = dirs.map((dir) =>
    path.join(graphifyOutDir(graphifyWorkspaceDir(repoRoot, names.get(dir) ?? path.basename(dir))), "wiki"),
  );
  const policy = readPolicy(homedir(), dirs, graphifyWikiRoots);
  const result = await readAllowedFile(filePath, policy);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }
  return NextResponse.json({
    name: path.basename(filePath),
    isMarkdown: DOC_MATCH(path.basename(filePath)),
    content: result.content,
    sizeBytes: result.sizeBytes,
  });
}
