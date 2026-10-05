import { emit, parseHookInput, readStdin, repoRoot, SILENT, type HookInput, type HookOutcome } from "./lib/hook-io";
import { logHook } from "./lib/log";
import { codegraphPromptHook } from "./indexes/codegraph";
import { graphifyGuardRead, graphifyGuardSearch } from "./indexes/graphify";
import { preToolUseAll } from "./indexes/pretooluse";
import { serenaRemind, serenaSessionEnd, serenaSessionStart } from "./indexes/serena";
import { docsCheck, docsWrite } from "./registry";
import { validateHooks } from "./validate";
import { hookBudgetReport } from "./doctor";

type HookFn = (root: string, raw: string, input: HookInput) => HookOutcome;

const HOOKS: Record<string, HookFn> = {
  "graphify/guard-search": graphifyGuardSearch,
  "graphify/guard-read": graphifyGuardRead,
  "codegraph/prompt-hook": codegraphPromptHook,
  "serena/session-start": serenaSessionStart,
  "serena/session-end": serenaSessionEnd,
  "serena/remind": serenaRemind,
  pretooluse: preToolUseAll,
};

async function main(): Promise<number> {
  const [tool, sub, flag] = process.argv.slice(2);
  const root = repoRoot();

  if (tool === "validate") {
    const problems = validateHooks(root);
    for (const problem of problems) process.stderr.write(`validate:hooks: ${problem}\n`);
    if (!problems.length) process.stdout.write("validate:hooks ok\n");
    return problems.length ? 1 : 0;
  }

  if (tool === "docs") {
    if (sub === "--write" || flag === "--write") {
      docsWrite(root);
      process.stdout.write("hooks docs: файлы хуков приведены к реестру\n");
      return 0;
    }
    const problems = docsCheck(root);
    for (const problem of problems) process.stderr.write(`hooks docs: ${problem}\n`);
    if (!problems.length) process.stdout.write("hooks docs ok\n");
    return problems.length ? 1 : 0;
  }

  if (tool === "doctor" && (sub === undefined || sub === "run" || sub === "hook-budget")) {
    const problems = hookBudgetReport(root);
    process.stdout.write(problems.length ? `hook-budget fail\n${problems.map((line) => `  ${line}`).join("\n")}\n` : "hook-budget ok\n");
    return problems.length ? 1 : 0;
  }

  const key = `${tool}/${sub}`;
  const hook = HOOKS[key];
  if (!hook) return 0;

  const raw = await readStdin();
  const input = parseHookInput(raw);
  const started = Date.now();
  let outcome: HookOutcome = SILENT;
  try {
    outcome = hook(root, raw, input);
  } catch {
    outcome = SILENT;
  }
  emit(outcome.output);
  logHook(root, key, Date.now() - started, Buffer.byteLength(outcome.output, "utf8"), outcome.childExit);
  return 0; // N-1: хук никогда не блокирует вызов
}

process.exit(await main());
