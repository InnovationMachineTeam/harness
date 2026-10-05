import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { loadVendorConfigs } from "./registry";
import { saveTaskMeta, taskTitle, type TaskLaunchInfo } from "./tasks";
import type { Issue, RuntimeAdapter } from "./types";

/**
 * Запуск промтов через рантайм по умолчанию: формируем текст задачи и спавним
 * headless-CLI в НОВОЙ сессии (cwd = корень репозитория). Процесс работает
 * независимо от запроса, вывод пишется в лог .agents/console/runs/.
 * Новая сессия появляется в общем списке сессий рантайма автоматически.
 */

/**
 * Безопасный аргумент-промт для execve: без NUL, ограниченной длины и без
 * ведущего дефиса (чтобы текст не распознался как флаг CLI).
 */
function sanitizePromptArg(text: string): string {
  const cleaned = text.replace(/\0/g, " ").trim().slice(0, 32_000);
  return cleaned.startsWith("-") ? ` ${cleaned}` : cleaned;
}

/**
 * Headless-CLI рантайма: команды и массивы аргументов литеральные
 * (промт - единственный переменный элемент, санитизирован в sanitizePromptArg),
 * оболочка не привлекается. Белый список команд - защита от подмены
 * runCommand в конфиге рантайма; каждый вызов spawn - с литеральной командой.
 */

/** Результат запуска headless-процесса (общий для промтов и агентских сборок). */
export interface HeadlessLaunchResult {
  ok: boolean;
  runtime: string;
  logFile: string;
  pid: number | null;
  detail: string;
}

/** Промпт исправления по проблеме диагностики. */
export function buildFixPrompt(issue: Issue, runtimeId: string, repoRoot: string): string {
  return [
    "Ты работаешь в репозитории harness (Harness). Исправь или улучши описанную ниже проблему диагностики.",
    "",
    `Рантайм, у которого обнаружена проблема: ${runtimeId}`,
    `Корень репозитория: ${repoRoot}`,
    "",
    "## Проблема",
    issue.title,
    issue.detail ? `Детали: ${issue.detail}` : "",
    issue.hint ? `Рекомендация: ${issue.hint}` : "",
    "",
    "## Требования",
    "- Соблюдай AGENTS.md и политику репозитория (guardrails/src/cli.ts): структурные изменения .agents/ - только с одобрения пользователя.",
    "- Вноси минимальные необходимые правки; не удаляй чужие записи в конфигах.",
    "- В конце кратко отчитайся, что изменено и как проверить.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface PromptRunResult extends HeadlessLaunchResult {
  ok: boolean;
  runtime: string;
  logFile: string;
  detail: string;
}

/** Уровень усилий (reasoning effort) для запуска; совпадает с thinkingLevel конфигов. */
export type EffortLevel = "low" | "medium" | "high" | "max";

/**
 * Дополнительные аргументы headless-CLI по рантайму для model/effort.
 * Матрица проверена по --help установленных CLI (10.2026):
 * - claude: --model <id>, --effort <low|medium|high|xhigh|max>;
 * - codex: -m <model>, -c model_reasoning_effort=<minimal|low|medium|high> (max -> high);
 * - opencode: -m provider/model, --variant <level> (уровень передаётся как есть);
 * - kimi: -m <model>; effort не поддерживается;
 * - zcode (node <cli> -p): флагов model/effort нет - параметры фиксируются в задаче.
 * Возвращает args перед промтом и env-добавки.
 */
export function headlessModelEffortArgs(
  runtimeId: string,
  opts: { model?: string; effort?: EffortLevel },
): { args: string[]; supported: boolean } {
  const model = opts.model?.trim();
  const effort = opts.effort?.trim();
  const args: string[] = [];
  switch (runtimeId) {
    case "claude":
      if (model) args.push("--model", model);
      if (effort) args.push("--effort", effort);
      return { args, supported: true };
    case "codex":
      if (model) args.push("-m", model);
      if (effort) args.push("-c", `model_reasoning_effort=${effort === "max" ? "high" : effort}`);
      return { args, supported: true };
    case "opencode":
      // формат модели opencode - provider/model; значение из конфига без "/"
      // (алиас) CLI не примет - не передаём
      if (model && model.includes("/")) args.push("-m", model);
      if (effort) args.push("--variant", effort);
      return { args, supported: true };
    case "kimi":
      if (model) args.push("-m", model);
      return { args, supported: true };
    default:
      return { args: [], supported: false };
  }
}

/** Модель конкретного tier из vendor-конфига рантайма; null - конфига нет. */
export async function runtimeModelForTier(
  repoRoot: string,
  runtimeId: string,
  tier: string,
): Promise<{ model: string; thinkingLevel: string; verified: boolean | undefined } | null> {
  const vendors = await loadVendorConfigs(repoRoot).catch(() => []);
  const vendor = vendors.find((v) => v.id === runtimeId);
  const found = vendor?.models?.[tier as keyof typeof vendor.models];
  return found ? { model: found.model, thinkingLevel: found.thinkingLevel ?? "", verified: found.verified } : null;
}

/** Запустить промт в новой headless-сессии рантайма (отвязанный процесс). */
export async function launchPromptRun(opts: {
  repoRoot: string;
  adapter: RuntimeAdapter;
  runtimeId: string;
  prompt: string;
  /** Рабочая папка запуска; по умолчанию - корень репозитория. */
  cwd?: string;
  /** Конкретная модель (проверенный id для данного CLI). */
  model?: string;
  /** Уровень усилий; неподдерживающий CLI получает его только в мету задачи. */
  effort?: EffortLevel;
  /** Correlation workflow для дерева агентов и статистики. */
  correlation?: {
    workflowRunId: string;
    workflowStepId: string;
    agentId?: string;
    parentAgentId?: string;
  };
  /**
   * Машинночитаемый JSONL-стрим (`--json`, только codex): события элементов
   * (agent_message, command_execution, ...) вместо человекочитаемого вывода;
   * direct-чат извлекает из стрима только текст ответа.
   */
  jsonStream?: boolean;
  /**
   * Машинночитаемый вывод (`--output-format json`): только для адаптеров с
   * headlessJson; движок workflow извлекает из конверта текст, usage и стоимость.
   */
  outputFormat?: "json";
}): Promise<PromptRunResult> {
  const { repoRoot, adapter, runtimeId } = opts;
  const cwd = opts.cwd ?? repoRoot;
  const prompt = sanitizePromptArg(opts.prompt);
  const extra = headlessModelEffortArgs(runtimeId, { model: opts.model, effort: opts.effort });
  const raw = adapter.runCommand?.(prompt);
  if (!raw) {
    return {
      ok: false,
      runtime: runtimeId,
      logFile: "",
      pid: null,
      detail: `рантайм ${runtimeId} не поддерживает headless-запуск промтов (нет CLI)`,
    };
  }
  // Конверт результата: флаг ставится только адаптерам с подтверждённой поддержкой.
  const formatArgs = opts.outputFormat === "json" && adapter.headlessJson ? ["--output-format", "json"] : [];
  if (raw.args.some((a) => a.includes("\0")) || extra.args.some((a) => a.includes("\0"))) {
    return {
      ok: false,
      runtime: runtimeId,
      logFile: "",
      pid: null,
      detail: "недопустимые символы в аргументах запуска",
    };
  }

  const runsDir = path.join(repoRoot, ".agents", "console", "runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(runsDir, `${stamp}-${runtimeId}.log`);
  const fh = await open(logFile, "a");

  const spawnOptions = {
    cwd,
    env: {
      ...process.env,
      ...(opts.correlation
        ? {
            HARNESS_WORKFLOW_RUN_ID: opts.correlation.workflowRunId,
            HARNESS_WORKFLOW_STEP_ID: opts.correlation.workflowStepId,
            HARNESS_AGENT_ID: opts.correlation.agentId ?? opts.correlation.workflowStepId,
            HARNESS_PARENT_AGENT_ID: opts.correlation.parentAgentId ?? "",
          }
        : {}),
    },
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  };
  // литеральные аргументы: префикс CLI, дополнение model/effort (headlessModelEffortArgs),
  // конверт вывода и промт последним - каждый элемент без NUL, оболочка не привлекается
  const extraArgs = [...formatArgs, ...extra.args];
  let child: ChildProcess | null = null;
  switch (raw.command) {
    case "claude":
      child = spawn("claude", ["-p", ...extraArgs, prompt], spawnOptions);
      break;
    case "codex":
      child = spawn("codex", ["exec", ...extraArgs, ...(opts.jsonStream ? ["--json"] : []), prompt], spawnOptions);
      break;
    case "kimi":
      child = spawn("kimi", ["-p", ...extraArgs, prompt], spawnOptions);
      break;
    case "opencode":
      child = spawn("opencode", ["run", ...extraArgs, prompt], spawnOptions);
      break;
    case "node":
      child = spawn("node", [raw.args[0], "-p", ...extraArgs, prompt], spawnOptions);
      break;
    default:
      child = null;
  }
  if (!child) {
    await fh.close();
    return {
      ok: false,
      runtime: runtimeId,
      logFile,
      pid: null,
      detail: `команда запуска не прошла проверку безопасности: ${raw.command}`,
    };
  }
  child.unref();
  // дескриптор лога продублирован в отвязанный процесс - копию родителя закрываем
  await fh.close().catch(() => undefined);
  // реестр задач: рантайм-запуск виден во вкладке "Мониторинг → Задачи"
  const effortNote = opts.effort
    ? extra.supported
      ? `, effort ${opts.effort}`
      : `, effort ${opts.effort} (CLI без флага - уровень не передан)`
    : "";
  const task: TaskLaunchInfo = {
    kind: "prompt",
    title: taskTitle(opts.prompt),
    executor: { type: "runtime", id: runtimeId },
    model: opts.model ?? (await runtimeStandardModel(repoRoot, runtimeId)),
    pid: child.pid ?? null,
    sessionRuntime: runtimeId,
    logFile,
    detail: `${cwd === repoRoot ? "корень репозитория" : cwd}${effortNote}`,
    workflowRunId: opts.correlation?.workflowRunId ?? null,
    workflowStepId: opts.correlation?.workflowStepId ?? null,
    agentId: opts.correlation?.agentId ?? opts.correlation?.workflowStepId ?? null,
    parentAgentId: opts.correlation?.parentAgentId ?? null,
  };
  await saveTaskMeta(repoRoot, task).catch(() => undefined);
  return {
    ok: true,
    runtime: runtimeId,
    logFile,
    pid: child.pid ?? null,
    detail: `промт запущен в новой сессии ${runtimeId} (PID ${child.pid}); сессия появится в списке сессий`,
  };
}

/** Модель tier standard из vendor-конфига рантайма (для бейджа задачи). */
async function runtimeStandardModel(repoRoot: string, runtimeId: string): Promise<string | null> {
  const vendors = await loadVendorConfigs(repoRoot).catch(() => []);
  const vendor = vendors.find((v) => v.id === runtimeId);
  return vendor?.models?.standard?.model ?? null;
}

/**
 * Промпт агентской сборки вики: ведёт не LLM-провайдер openwiki, а
 * headless-сессия кодинг-агента с установленной интеграцией openwiki
 * (скилл + MCP-инструменты жизненного цикла). mode/language - из плана
 * сборки (wikiBuildPlan в core/memory.ts), как у CLI-режима.
 */
export function buildWikiAgentPrompt(opts: {
  workspaceDir: string;
  mode: "init" | "update";
  language: string;
}): string {
  const verb = opts.mode === "init" ? "инициализируй" : "обнови";
  return [
    `Ты ведёшь вики OpenWiki для папки ${opts.workspaceDir}. ${verb} её в режиме ${opts.mode}.`,
    "",
    "Используй навык openwiki и его MCP-инструменты жизненного цикла:",
    "openwiki_begin - openwiki_submit_plan - openwiki_next_page - (исследование и запись страницы) - openwiki_submit_page - ... - openwiki_finish.",
    `Язык вики: ${opts.language} - веди все страницы на этом языке.`,
    "Не изменяй исходники репозитория - только каталог openwiki/ внутри папки.",
    "Если инструменты openwiki недоступны - остановись и напиши, что интеграция openwiki не установлена для этого рантайма.",
    "",
    "Соблюдай AGENTS.md и политику репозитория (guardrails/src/cli.ts).",
  ].join("\n");
}

/**
 * Запустить агентскую сборку вики: headless-сессия рантайма с cwd = рабочая
 * папка. Промпт собирается здесь из структурированных полей (mode/language -
 * из плана сборки wikiBuildPlan), свободный текст пользователя в spawn не
 * попадает. Вывод агента - в openwiki/.console-build.log (тот же лог, что у
 * CLI-сборки); pid агента пишет в мету startWikiBuildViaAgent
 * (core/memory.ts). Задача попадает в реестр (kind "openwiki-build",
 * исполнитель - рантайм) со ссылкой на сессию.
 */
export async function launchAgentWikiBuild(opts: {
  repoRoot: string;
  workspaceDir: string;
  adapter: RuntimeAdapter;
  runtimeId: string;
  mode: "init" | "update";
  language: string;
  logFile: string;
}): Promise<HeadlessLaunchResult> {
  const { repoRoot, adapter, runtimeId, workspaceDir } = opts;
  const prompt = sanitizePromptArg(
    buildWikiAgentPrompt({ workspaceDir: opts.workspaceDir, mode: opts.mode, language: opts.language }),
  );
  const raw = adapter.runCommand?.(prompt);
  if (!raw) {
    return {
      ok: false,
      runtime: runtimeId,
      logFile: opts.logFile,
      pid: null,
      detail: `рантайм ${runtimeId} не поддерживает headless-запуск (нет CLI)`,
    };
  }
  const fh = await open(opts.logFile, "a");
  const spawnOptions = {
    cwd: workspaceDir,
    env: process.env,
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  };
  let child: ChildProcess | null = null;
  switch (raw.command) {
    case "claude":
      child = spawn("claude", ["-p", prompt], spawnOptions);
      break;
    case "codex":
      child = spawn("codex", ["exec", prompt], spawnOptions);
      break;
    case "kimi":
      child = spawn("kimi", ["-p", prompt], spawnOptions);
      break;
    case "opencode":
      child = spawn("opencode", ["run", prompt], spawnOptions);
      break;
    case "node":
      child = spawn("node", [raw.args[0], "-p", prompt], spawnOptions);
      break;
    default:
      child = null;
  }
  if (!child) {
    await fh.close();
    return {
      ok: false,
      runtime: runtimeId,
      logFile: opts.logFile,
      pid: null,
      detail: `команда запуска не прошла проверку безопасности: ${raw.command}`,
    };
  }
  child.unref();
  await saveTaskMeta(repoRoot, {
    kind: "openwiki-build",
    title: `Сборка вики OpenWiki через агент (${opts.mode})`,
    executor: { type: "runtime", id: runtimeId },
    model: await runtimeStandardModel(repoRoot, runtimeId),
    pid: child.pid ?? null,
    sessionRuntime: runtimeId,
    logFile: opts.logFile,
    detail: workspaceDir,
  }).catch(() => undefined);
  await fh.close();
  return {
    ok: true,
    runtime: runtimeId,
    logFile: opts.logFile,
    pid: child.pid ?? null,
    detail: `агентская сборка (${opts.mode}) запущена в сессии ${runtimeId} (PID ${child.pid})`,
  };
}
