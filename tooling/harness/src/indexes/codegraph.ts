import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { capOutput, isAlive } from "../lib/limits";
import { SILENT, type HookInput, type HookOutcome } from "../lib/hook-io";
import { realDeps, type HookDeps } from "./deps";

const PROMPT_TIMEOUT_MS = 3000;
const MIN_PROMPT_LENGTH = 15;
const SKIP_PREFIXES = ["<bash-input>", "<bash-stdout>", "<task-notification>"];

// C-1, C-2, C-3: ограничитель вывода, фильтр нетехнических промптов, признак fallback-writer.
export function codegraphPromptHook(
  root: string,
  raw: string,
  input: HookInput,
  deps: HookDeps = realDeps,
): HookOutcome {
  const prompt = (input.prompt ?? "").trim();
  if (prompt.length < MIN_PROMPT_LENGTH) return SILENT;
  if (SKIP_PREFIXES.some((prefix) => prompt.startsWith(prefix))) return SILENT;
  if (!existsSync(join(root, ".codegraph", "codegraph.db"))) return SILENT;

  const pidFile = join(root, ".codegraph", "writer.pid");
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      return {
        output: `codegraph: index writer lock held by PID ${pid} (fallback mode). Restart the codegraph session to release it.`,
        fired: true,
        childExit: 0,
      };
    }
  }

  const child = deps.runChild("codegraph", ["prompt-hook"], { input: raw, timeoutMs: PROMPT_TIMEOUT_MS, cwd: root });
  if (child.missing || !child.stdout.trim()) return SILENT;
  return { output: capOutput(child.stdout), fired: true, childExit: child.exitCode };
}
