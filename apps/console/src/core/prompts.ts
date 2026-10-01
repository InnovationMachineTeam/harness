import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
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
 * Спавн headless-CLI рантайма: команды и массивы аргументов литеральные
 * (промт - единственный переменный элемент, санитизирован выше),
 * оболочка не привлекается.
 */

/** Промпт исправления по проблеме диагностики. */
export function buildFixPrompt(issue: Issue, runtimeId: string, repoRoot: string): string {
  return [
    "Ты работаешь в репозитории harness (Agentic OS). Исправь или улучши описанную ниже проблему диагностики.",
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
    "- Соблюдай AGENTS.md и guard-политику репозитория (.agents/runtime/guard.mjs): структурные изменения .agents/ - только с одобрения пользователя.",
    "- Вноси минимальные необходимые правки; не удаляй чужие записи в конфигах.",
    "- В конце кратко отчитайся, что изменено и как проверить.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface PromptRunResult {
  ok: boolean;
  runtime: string;
  logFile: string;
  detail: string;
}

/** Запустить промт в новой headless-сессии рантайма (отвязанный процесс). */
export async function launchPromptRun(opts: {
  repoRoot: string;
  adapter: RuntimeAdapter;
  runtimeId: string;
  prompt: string;
}): Promise<PromptRunResult> {
  const { repoRoot, adapter, runtimeId } = opts;
  const prompt = sanitizePromptArg(opts.prompt);
  const raw = adapter.runCommand?.(prompt);
  if (!raw) {
    return {
      ok: false,
      runtime: runtimeId,
      logFile: "",
      detail: `рантайм ${runtimeId} не поддерживает headless-запуск промтов (нет CLI)`,
    };
  }
  if (raw.args.some((a) => a.includes("\0"))) {
    return {
      ok: false,
      runtime: runtimeId,
      logFile: "",
      detail: "недопустимые символы в аргументах запуска",
    };
  }

  const runsDir = path.join(repoRoot, ".agents", "console", "runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(runsDir, `${stamp}-${runtimeId}.log`);
  const fh = await open(logFile, "a");

  const spawnOptions = {
    cwd: repoRoot,
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
      logFile,
      detail: `команда запуска не прошла проверку безопасности: ${raw.command}`,
    };
  }
  child.unref();
  return {
    ok: true,
    runtime: runtimeId,
    logFile,
    detail: `промт запущен в новой сессии ${runtimeId} (PID ${child.pid}); сессия появится в списке сессий`,
  };
}
