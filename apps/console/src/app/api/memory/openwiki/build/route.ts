import { NextResponse } from "next/server";
import { openwikiCli, processAlive, readBuildMeta, startWikiBuild } from "@/core/memory";
import { openwikiLlmEnv, openwikiLlmConfig } from "@/core/openwikiLlm";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/openwiki/build {dir}
 * Запустить сборку вики в рабочей папке (openwiki --init|--update, отвязанный
 * процесс, лог в openwiki/.console-build.log). Сборку ведёт сам openwiki CLI.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  if (!dir || !workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  const cli = await openwikiCli();
  if (!cli.installed) {
    return NextResponse.json(
      { error: "openwiki CLI не установлен: npm install -g openwiki" },
      { status: 400 },
    );
  }
  const meta = await readBuildMeta(dir);
  if (meta && processAlive(meta.pid)) {
    return NextResponse.json({ error: "сборка уже идёт" }, { status: 409 });
  }
  const llmEnv = openwikiLlmEnv(openwikiLlmConfig(ctx.state));
  const result = await startWikiBuild(dir, llmEnv);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
