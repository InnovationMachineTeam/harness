import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { gitInit, gitRepoStatus } from "@/core/git";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/git/init {dir} - инициализировать git-репозиторий в рабочей папке
 * (кнопка "✕ Git" селектора веток). Ответ - статус репозитория после init.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  if (!dir || !workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  try {
    await stat(dir);
  } catch {
    return NextResponse.json({ error: `каталог не существует: ${dir}` }, { status: 400 });
  }
  const result = gitInit(dir);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, dir, ...gitRepoStatus(dir) });
}
