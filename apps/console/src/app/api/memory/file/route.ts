import { homedir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { DOC_MATCH, readAllowedFile, readPolicy } from "@/core/memory";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/file?path=<абсолютный путь>
 * Содержимое файла из разрешённых корней памяти (доки рабочих папок, openwiki/,
 * memory-каталоги рантаймов). Произвольные пути и скрытые файлы запрещены.
 */
export async function GET(request: Request) {
  const { state } = await serverContext();
  const filePath = new URL(request.url).searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "нужен параметр path" }, { status: 400 });
  }
  const policy = readPolicy(homedir(), workspaceDirs(state));
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
