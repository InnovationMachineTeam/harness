import path from "node:path";
import { NextResponse } from "next/server";
import {
  graphifyCliInstalled,
  graphifyStatus,
  graphifyWorkspaceDir,
  readGraphifyBuildMeta,
  startGraphifyBuild,
} from "@/core/graphify";
import { processAlive } from "@/core/memory";
import { graphifyBackendArg, graphifyLlmConfig, graphifyLlmEnv } from "@/core/openwikiLlm";
import { GRAPHIFY_PRESETS, presetById } from "@/core/llmPresets";
import { appendUsageEvent } from "@/core/toolsUsage";
import { mandatoryWorkspace } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/graphify/build {dir}
 * Запустить сборку графа рабочей папки в хранилище воркспейсов
 * (`graphify extract <dir> --out <repoRoot>/graphify/<имя>`; повторный запуск
 * инкрементален, отвязанный процесс, лог в graphify-out/.console-build.log).
 * Сборка выполняется только в обязательной рабочей папке (write mode);
 * запрошенная папка сводится к ней. Бэкенд LLM берётся из пресета
 * state.graphifyLlm: с бэкендом корпус полный (код + доки), без него сборка
 * идёт с --code-only (локальный AST).
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: string } | null;
  const dir = mandatoryWorkspace(ctx.state);
  if (body?.dir && body.dir !== dir) {
    return NextResponse.json({ error: `сборка графа выполняется только в обязательной рабочей папке: ${dir}` }, { status: 400 });
  }
  if (!graphifyCliInstalled()) {
    return NextResponse.json(
      { error: "graphify CLI не установлен - Настройки → Инструменты или uv tool install graphifyy" },
      { status: 400 },
    );
  }
  const name = path.basename(dir);
  const storeDir = graphifyWorkspaceDir(ctx.repoRoot, name);
  const meta = await readGraphifyBuildMeta(storeDir);
  if (meta && processAlive(meta.pid)) {
    return NextResponse.json({ error: "сборка графа уже идёт" }, { status: 409 });
  }
  const status = await graphifyStatus(fsSignals, storeDir);
  const llm = graphifyLlmConfig(ctx.state);
  const llmEnv = graphifyLlmEnv(llm);
  const result = await startGraphifyBuild({
    sourceDir: dir,
    storeDir,
    repoRoot: ctx.repoRoot,
    extraEnv: llmEnv,
    // бэкенд не настроен - локальная code-only сборка (AST, без LLM-ключа)
    codeOnly: !graphifyBackendArg(llm),
    backend: graphifyBackendArg(llm),
    model: llm.modelId || null,
    task: { model: llm.modelId || presetById(GRAPHIFY_PRESETS, llm.preset)?.label || llm.preset },
  });
  if (result.ok) {
    await appendUsageEvent(ctx.repoRoot, {
      tool: "graphify",
      action: "build",
      detail: `${result.mode} (было: ${status.nodes ?? "?"} узлов)`,
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
