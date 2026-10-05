import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { gitRepoStatus } from "@/core/git";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/git/status?dir=... - статус git-репозитория рабочей папки:
 * доступность git, репозиторий ли это, текущая ветка и список локальных веток.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const dir = new URL(request.url).searchParams.get("dir") ?? "";
  if (!dir || !workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  try {
    await stat(dir);
  } catch {
    return NextResponse.json({ error: `каталог не существует: ${dir}` }, { status: 400 });
  }
  return NextResponse.json({ dir, ...gitRepoStatus(dir) });
}
