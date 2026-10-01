import { NextResponse } from "next/server";
import { graphifyCliInstalled, graphifyStatus, readGraphifyBuildMeta, startGraphifyBuild } from "@/core/graphify";
import { processAlive } from "@/core/memory";
import { graphifyLlmConfig, graphifyLlmEnv } from "@/core/openwikiLlm";
import { appendUsageEvent } from "@/core/toolsUsage";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/graphify/build {dir}
 * Запустить сборку графа Graphify в рабочей папке (graphify extract|update .,
 * отвязанный процесс, лог в graphify-out/.console-build.log).
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = body?.dir;
  if (!dir || !workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  if (!graphifyCliInstalled()) {
    return NextResponse.json(
      { error: "graphify CLI не установлен - Настройки → Инструменты или uv tool install graphifyy" },
      { status: 400 },
    );
  }
  const meta = await readGraphifyBuildMeta(dir);
  if (meta && processAlive(meta.pid)) {
    return NextResponse.json({ error: "сборка графа уже идёт" }, { status: 409 });
  }
  const status = await graphifyStatus(fsSignals, dir);
  const llmEnv = graphifyLlmEnv(graphifyLlmConfig(ctx.state));
  const result = await startGraphifyBuild(dir, llmEnv);
  if (result.ok) {
    await appendUsageEvent(ctx.repoRoot, {
      tool: "graphify",
      action: "build",
      detail: `${result.mode} (было: ${status.nodes ?? "?"} узлов)`,
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
