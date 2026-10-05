import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { capOutput } from "../lib/limits";
import { SILENT, type HookInput, type HookOutcome } from "../lib/hook-io";
import { hasFlag, sessionDir, setFlag } from "../lib/state";
import { realDeps, type HookDeps } from "./deps";
import type { ChildResult } from "../lib/child";

const SESSION_TIMEOUT_MS = 2000;
const REMIND_LARGE_FILE_LINES = 300;
const REMIND_FLAG = "serena-remind-shown";

function fromChild(child: ChildResult): HookOutcome {
  if (child.missing || !child.stdout.trim()) return SILENT;
  return { output: capOutput(child.stdout), fired: true, childExit: child.exitCode };
}

function projectIndexed(root: string): boolean {
  return existsSync(join(root, ".serena", "project.yml"));
}

// S-1: подсказка активации только для проиндексированного проекта с установленной Serena.
export function serenaSessionStart(
  root: string,
  raw: string,
  input: HookInput,
  deps: HookDeps = realDeps,
): HookOutcome {
  if (!projectIndexed(root)) return SILENT;
  if (deps.commandExists("serena-hooks")) {
    return fromChild(deps.runChild("serena-hooks", ["activate"], { input: raw, timeoutMs: SESSION_TIMEOUT_MS, cwd: root }));
  }
  if (deps.commandExists("serena")) {
    return {
      output: "Serena: project is indexed in .serena/. Activate the project (activate_project) and read Serena's instructions before other work.",
      fired: true,
      childExit: 0,
    };
  }
  return SILENT;
}

export function serenaSessionEnd(
  root: string,
  raw: string,
  input: HookInput,
  deps: HookDeps = realDeps,
): HookOutcome {
  if (!deps.commandExists("serena-hooks")) return SILENT;
  deps.runChild("serena-hooks", ["cleanup"], { input: raw, timeoutMs: SESSION_TIMEOUT_MS, cwd: root });
  return SILENT;
}

// S-2: напоминание про символы Serena только для .ts/.tsx больше 300 строк, один раз за сессию.
export function serenaRemind(root: string, raw: string, input: HookInput, deps: HookDeps = realDeps): HookOutcome {
  const candidate = input.tool_input?.file_path ?? input.tool_input?.path;
  const filePath = typeof candidate === "string" ? candidate : "";
  if (!/\.(ts|tsx)$/.test(filePath)) return SILENT;
  if (!projectIndexed(root)) return SILENT;
  let isFile = false;
  try {
    isFile = statSync(filePath).isFile();
  } catch {
    return SILENT;
  }
  if (!isFile) return SILENT;
  let lines = 0;
  try {
    const content = readFileSync(filePath, "utf8");
    lines = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  } catch {
    return SILENT;
  }
  if (lines <= REMIND_LARGE_FILE_LINES) return SILENT;

  const dir = sessionDir(root, input.session_id);
  if (hasFlag(dir, REMIND_FLAG)) return SILENT;
  setFlag(dir, REMIND_FLAG);

  const child = deps.runChild("serena-hooks", ["remind"], { input: raw, timeoutMs: SESSION_TIMEOUT_MS, cwd: root });
  if (child.stdout.trim()) return fromChild(child);
  return {
    output: `Serena: ${basename(filePath)} has ${lines} lines. Prefer mcp__serena__get_symbols_overview and mcp__serena__find_symbol over reading the whole file.`,
    fired: true,
    childExit: child.exitCode,
  };
}
