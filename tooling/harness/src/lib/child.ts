import { spawnSync } from "node:child_process";
import { constants as fsConstants, accessSync } from "node:fs";
import { join } from "node:path";

// Обёртка исполняет только фиксированный набор CLI индексов.
export type ToolBinary = "codegraph" | "graphify" | "serena-hooks";

export interface ChildResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
  missing: boolean;
}

export interface ChildOptions {
  input?: string;
  timeoutMs?: number;
  cwd?: string;
}

interface SpawnOutcome {
  error?: NodeJS.ErrnoException;
  stdout?: string;
  status?: number | null;
  signal?: string | null;
}

function runTool(binary: ToolBinary, args: string[], opts: ChildOptions): SpawnOutcome {
  const settings = {
    input: opts.input ?? "",
    timeout: opts.timeoutMs,
    cwd: opts.cwd,
    encoding: "utf8" as const,
    maxBuffer: 32 * 1024 * 1024,
    killSignal: "SIGKILL" as const,
  };
  switch (binary) {
    case "codegraph":
      return spawnSync("codegraph", args, settings);
    case "graphify":
      return spawnSync("graphify", args, settings);
    case "serena-hooks":
      return spawnSync("serena-hooks", args, settings);
  }
}

export function runChild(cmd: string, args: string[], opts: ChildOptions = {}): ChildResult {
  if (cmd !== "codegraph" && cmd !== "graphify" && cmd !== "serena-hooks") {
    return { stdout: "", exitCode: 0, timedOut: false, missing: true };
  }
  const result = runTool(cmd, args, opts);
  if (result.error?.code === "ENOENT") {
    return { stdout: "", exitCode: 0, timedOut: false, missing: true };
  }
  return {
    stdout: result.stdout ?? "",
    exitCode: result.status ?? (result.error ? 1 : 0),
    timedOut: result.signal === "SIGKILL",
    missing: false,
  };
}

export function commandExists(cmd: "codegraph" | "graphify" | "serena-hooks" | "serena" | "bun"): boolean {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    try {
      accessSync(join(dir, cmd), fsConstants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
