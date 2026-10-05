import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import {
  openwikiCli,
  processAlive,
  readBuildMeta,
  resolveWikiBuildPlan,
  startWikiBuild,
  startWikiBuildViaAgent,
  wikiIntegrationDir,
} from "@/core/memory";
import { openwikiLlmEnv, openwikiLlmConfig } from "@/core/openwikiLlm";
import { mandatoryWorkspace, resolveTaskRuntime } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Есть ли каталог проектной интеграции openwiki у рантайма. */
async function integrationInstalled(repoRoot: string, runtimeId: string): Promise<boolean> {
  const dir = wikiIntegrationDir(repoRoot, runtimeId);
  if (!dir) return false;
  return stat(dir).then(
    () => true,
    () => false,
  );
}

/**
 * Git-корень папки или null (не репозиторий). Агентская сборка ведёт вики
 * git-корня (openwiki_begin резолвит его от cwd), поэтому вложенная рабочая
 * папка (docs/ внутри корня репозитория) в этом режиме отклоняется.
 */
function gitTopLevel(dir: string): string | null {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", timeout: 5000 });
  const out = res.status === 0 ? res.stdout.trim() : "";
  return out || null;
}

/**
 * POST /api/memory/openwiki/build {dir, via?: "cli" | "agent", runtime?}
 * Запустить сборку вики в рабочей папке. Сборка выполняется только в
 * обязательной рабочей папке (write mode); запрошенная папка сводится к ней.
 * Режимы:
 * - "cli" (по умолчанию): openwiki --init|--update с LLM-провайдером
 *   (openwikiLlmEnv), отвязанный процесс, лог в openwiki/.console-build.log;
 * - "agent": headless-сессия рантайма с интеграцией openwiki (скилл + MCP)
 *   пишет страницы своей моделью; рантайм - из задачи "Исполнение команд"
 *   (★) или явный runtime в запросе.
 * Прерванная сборка (resume) обрабатывается одинаково - resolveWikiBuildPlan.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { dir?: string; via?: string; runtime?: string }
    | null;
  const dir = mandatoryWorkspace(ctx.state);
  if (body?.dir && body.dir !== dir) {
    return NextResponse.json({ error: `сборка вики выполняется только в обязательной рабочей папке: ${dir}` }, { status: 400 });
  }
  const meta = await readBuildMeta(dir);
  if (meta && processAlive(meta.pid)) {
    return NextResponse.json({ error: "сборка уже идёт" }, { status: 409 });
  }
  const plan = await resolveWikiBuildPlan(dir);

  if (body?.via === "agent") {
    const runtimeId = body.runtime ?? resolveTaskRuntime(ctx.state, "promptExecution");
    if (!runtimeId) {
      return NextResponse.json(
        { error: "не выбран рантайм - назначьте его в настройках для \"Исполнение команд\" или выберите ★" },
        { status: 400 },
      );
    }
    const adapter = ctx.adapters[runtimeId];
    if (!adapter) return NextResponse.json({ error: `неизвестный рантайм: ${runtimeId}` }, { status: 400 });
    if (!adapter.runCommand) {
      return NextResponse.json(
        { error: `рантайм ${runtimeId} не поддерживает headless-запуск - выберите другой ★` },
        { status: 400 },
      );
    }
    if (!(await integrationInstalled(ctx.repoRoot, runtimeId))) {
      return NextResponse.json(
        {
          error: `у рантайма ${runtimeId} нет проектной интеграции openwiki - выполните "openwiki integrations install" для него`,
        },
        { status: 400 },
      );
    }
    const top = gitTopLevel(dir);
    if (!top) {
      return NextResponse.json({ error: "агентская сборка возможна только внутри git-репозитория" }, { status: 400 });
    }
    const real = await realpath(dir).catch(() => dir);
    if (real !== top) {
      return NextResponse.json(
        {
          error: `агентская сборка ведёт вики git-корня (${top}), а не вложенной папки - для неё используйте обычный режим (CLI)`,
        },
        { status: 400 },
      );
    }
    const result = await startWikiBuildViaAgent(dir, { repoRoot: ctx.repoRoot, adapter, runtimeId, plan });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const cli = await openwikiCli();
  if (!cli.installed) {
    return NextResponse.json(
      { error: "openwiki CLI не установлен: npm install -g openwiki" },
      { status: 400 },
    );
  }
  const llm = openwikiLlmConfig(ctx.state);
  const llmEnv = openwikiLlmEnv(llm);
  const result = await startWikiBuild(dir, llmEnv, {
    model: llm.modelId || llm.preset,
    repoRoot: ctx.repoRoot,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
