import { spawn, execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Общий исполнитель хуков жизненного цикла (навыки, MCP-серверы, плагины,
 * инструменты). Команда хука перед исполнением проходит guard-политику
 * репозитория (.guardrails/src/cli.ts; любой ненулевой exit - отказ),
 * затем исполняется `bash -c` с cwd = обязательная рабочая папка (write mode),
 * если вызывающий не передал собственный каталог. Лог домена -
 * `.agents/console/hooks/<домен>.log` (навыки - прежний skill-hooks.log).
 */

export const lifecycleHooksSchema = z.object({
  install: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
  enable: z.array(z.string()).default([]),
  disable: z.array(z.string()).default([]),
});

export type LifecycleHooks = z.infer<typeof lifecycleHooksSchema>;

export type HookDomain = "skill" | "mcp" | "plugin" | "tool";
export type HookOp = "install" | "remove" | "enable" | "disable";

const HOOK_TIMEOUT_MS = 60_000;
const HOOK_OUTPUT_MAX_BYTES = 1_000_000;

export function emptyLifecycleHooks(): LifecycleHooks {
  return { install: [], remove: [], enable: [], disable: [] };
}

/** Нормализовать частичное объявление хуков (из state.json, манифеста или кода). */
export function lifecycleHooksOf(hooks?: Partial<LifecycleHooks> | null): LifecycleHooks {
  return hooks ? { ...emptyLifecycleHooks(), ...hooks } : emptyLifecycleHooks();
}

export async function appendHookLog(repoRoot: string, domain: HookDomain, line: string): Promise<void> {
  const file =
    domain === "skill"
      ? path.join(repoRoot, ".agents", "console", "skill-hooks.log")
      : path.join(repoRoot, ".agents", "console", "hooks", `${domain}.log`);
  await mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  await appendFile(file, `[${new Date().toISOString()}] ${line}\n`, "utf8").catch(() => undefined);
}

/** Guard-проверка команды (exit 0 - разрешено, 2 - блок, иная ошибка - отказ). */
export function guardAllows(repoRoot: string, command: string, domain: HookDomain): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", [".guardrails/src/cli.ts", "evaluate"], {
      cwd: repoRoot,
      env: { ...process.env, AGENT_RUNTIME: "console", GUARDRAILS_INTEGRATION: "code:console:lifecycle-hook" },
    });
    let stderr = "";
    child.stdin.write(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
    child.stdin.end();
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const finish = (ok: boolean, reason?: string) => {
      resolve({ ok, reason });
      void appendHookLog(repoRoot, domain, `guard ${ok ? "allow" : "block"}: ${command}${reason ? " - " + reason : ""}`);
    };
    child.on("error", (error) => finish(false, error instanceof Error ? error.message : String(error)));
    child.on("close", (code) => (code === 0 ? finish(true) : finish(false, stderr.slice(0, 500))));
  });
}

function runHookCommand(cwd: string, command: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["-c", command],
      { cwd, timeout: HOOK_TIMEOUT_MS, maxBuffer: HOOK_OUTPUT_MAX_BYTES },
      (error, stdout, stderr) => {
        if (!error) resolve({ ok: true, output: stdout.toString() });
        else {
          const message = (stderr || stdout || "").toString().slice(0, 1000) || (error instanceof Error ? error.message : String(error));
          resolve({ ok: false, output: message });
        }
      },
    );
  });
}

export interface LifecycleHookOutcome {
  done: string[];
  errors: string[];
}

/** Исполнить команды одного хука: guard → bash -c → лог домена. */
export async function runLifecycleHook(opts: {
  repoRoot: string;
  /** Обязательная рабочая папка (write mode) - cwd по умолчанию. */
  workspace: string;
  domain: HookDomain;
  name: string;
  op: HookOp;
  hooks?: Partial<LifecycleHooks> | null;
  /** Собственный cwd исполнителя (навыки - каталог навыка); по умолчанию workspace. */
  cwd?: string;
}): Promise<LifecycleHookOutcome> {
  const done: string[] = [];
  const errors: string[] = [];
  const commands = lifecycleHooksOf(opts.hooks)[opts.op];
  const cwd = opts.cwd ?? opts.workspace;
  for (const command of commands) {
    const guard = await guardAllows(opts.repoRoot, command, opts.domain);
    if (!guard.ok) {
      errors.push(`guard отклонил команду хука: ${command}${guard.reason ? " - " + guard.reason : ""}`);
      continue;
    }
    const outcome = await runHookCommand(cwd, command);
    await appendHookLog(
      opts.repoRoot,
      opts.domain,
      `${opts.op} ${opts.name}: ${command} -> ${outcome.ok ? "ok" : "error"}\n${outcome.output.slice(0, 800)}`,
    );
    if (outcome.ok) done.push(`хук: ${command}`);
    else errors.push(`хук не выполнен: ${command} - ${outcome.output.slice(0, 300)}`);
  }
  return { done, errors };
}
