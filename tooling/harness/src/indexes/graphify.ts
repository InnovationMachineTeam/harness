import { capOutput } from "../lib/limits";
import { SILENT, type HookInput, type HookOutcome } from "../lib/hook-io";
import { bumpCounter, hasFlag, sessionDir, setFlag } from "../lib/state";
import { realDeps, type HookDeps } from "./deps";
import type { ChildResult } from "../lib/child";

const GUARD_TIMEOUT_MS = 5000;
const READ_EVERY = 10;
const QUERY_FLAG = "graphify-query-done";
const READ_COUNTER = "graphify-read-count";
const SEARCH_FIRST = new Set(["grep", "rg", "ag", "find"]);

export function firstPipelineToken(command: string): string {
  const head = command.split("|")[0].split(/&&|;|\n/)[0].trim();
  for (const token of head.split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return "";
}

function fromChild(child: ChildResult): HookOutcome {
  if (child.missing || !child.stdout.trim()) return SILENT;
  return { output: capOutput(child.stdout), fired: true, childExit: child.exitCode };
}

// G-1: срабатывает, только когда поиск - первая команда конвейера; фильтр после "|" молчит.
export function graphifyGuardSearch(
  root: string,
  raw: string,
  input: HookInput,
  deps: HookDeps = realDeps,
): HookOutcome {
  const tool = input.tool_name ?? "";
  const command = String(input.tool_input?.command ?? "");
  if (tool === "Bash") {
    if (/graphify\s+query\b/.test(command)) setFlag(sessionDir(root, input.session_id), QUERY_FLAG);
    if (!SEARCH_FIRST.has(firstPipelineToken(command))) return SILENT;
  } else if (tool !== "Grep") {
    return SILENT;
  }
  return fromChild(deps.runChild("graphify", ["hook-guard", "search"], { input: raw, timeoutMs: GUARD_TIMEOUT_MS, cwd: root }));
}

// G-2: не чаще одного раза на 10 чтений и молчит после graphify query в сессии.
export function graphifyGuardRead(
  root: string,
  raw: string,
  input: HookInput,
  deps: HookDeps = realDeps,
): HookOutcome {
  const dir = sessionDir(root, input.session_id);
  if (hasFlag(dir, QUERY_FLAG)) return SILENT;
  const readNumber = bumpCounter(dir, READ_COUNTER);
  if ((readNumber - 1) % READ_EVERY !== 0) return SILENT;
  return fromChild(
    deps.runChild("graphify", ["hook-guard", "read", "--strict"], { input: raw, timeoutMs: GUARD_TIMEOUT_MS, cwd: root }),
  );
}
