import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { gitCheckoutBranch, gitCreateBranch, gitRepoStatus } from "@/core/git";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/git/branch {dir, name, create?} - ветки рабочей папки:
 * create (по умолчанию true) - создать ветку и переключиться (git checkout -b);
 * create: false - переключиться на существующую (git checkout <name>).
 * Ответ - статус репозитория: выбранная ветка становится текущей.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { dir?: string; name?: string; create?: boolean }
    | null;
  const dir = body?.dir;
  const name = body?.name?.trim();
  if (!dir || !workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "нужно имя ветки" }, { status: 400 });
  }
  try {
    await stat(dir);
  } catch {
    return NextResponse.json({ error: `каталог не существует: ${dir}` }, { status: 400 });
  }
  const status = gitRepoStatus(dir);
  if (!status.isRepo) {
    return NextResponse.json({ error: "в папке нет git-репозитория - сначала инициализируйте его" }, { status: 400 });
  }
  const result = body?.create === false ? gitCheckoutBranch(dir, name) : gitCreateBranch(dir, name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, dir, ...gitRepoStatus(dir) });
}
