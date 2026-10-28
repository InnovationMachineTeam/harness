// Адаптер контракта хуков Antigravity. Antigravity передаёт вызов инструмента
// на stdin в camelCase (toolCall: {name, args}) и ждёт вердикт в stdout JSON
// ({"decision": "allow" | "deny", "reason": ...}); exit-коды вердиктом не
// являются. Ядро guard (cli.ts evaluate) говорит на exit-кодах: 0 - разрешено,
// 2 - блок. Обёртка переводит один контракт в другой и всегда завершается
// кодом 0: без bun или без guard вердикт не печатается, и Antigravity
// применяет собственную политику по умолчанию (fail-open).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Имена инструментов Antigravity -> имена инструментов guard.
const TOOL_NAME_MAP: Record<string, string> = {
  run_command: "Bash",
  view_file: "Read",
  edit_file: "Edit",
  write_file: "Write",
  replace_file_content: "Edit",
  code_action: "Edit",
  list_directory: "Glob",
  search_web: "WebFetch",
};

interface AntigravityHookInput {
  toolCall?: { name?: unknown; args?: unknown };
}

function parseStdin(): AntigravityHookInput | null {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as AntigravityHookInput;
  } catch {
    return null;
  }
}

function main(): void {
  const payload = parseStdin();
  const rawName = payload?.toolCall?.name;
  const rawArgs = payload?.toolCall?.args;
  const name = typeof rawName === "string" ? rawName : "";
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};

  const guardPayload = JSON.stringify({
    tool_name: TOOL_NAME_MAP[name] ?? name,
    tool_input: args,
  });

  const child = spawnSync("bun", [".guardrails/src/cli.ts", "evaluate"], {
    input: guardPayload,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_RUNTIME: process.env.AGENT_RUNTIME ?? "antigravity",
      AGENT_RUNTIME_CONFIG:
        process.env.AGENT_RUNTIME_CONFIG ?? ".agents/runtime/antigravity/config.json",
      GUARDRAILS_INTEGRATION: process.env.GUARDRAILS_INTEGRATION ?? "runtime:antigravity:PreToolUse",
    },
  });

  if (child.error || child.status === null) {
    process.stderr.write(
      `antigravity-hook: guard not started: ${String(child.error ?? "no exit code")}\n`,
    );
    return;
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }
  if (child.status === 0) {
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    return;
  }
  if (child.status === 2) {
    const reason = child.stderr.trim() || "blocked by guardrails policy";
    process.stdout.write(JSON.stringify({ decision: "deny", reason }) + "\n");
    return;
  }
  process.stderr.write(`antigravity-hook: guard exited with ${child.status}: no decision\n`);
}

main();
