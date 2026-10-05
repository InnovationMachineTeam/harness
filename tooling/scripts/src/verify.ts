import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const sub = process.argv[2] ?? "verify-fast";

interface Step {
  name: string;
  run: () => number;
}

// nx вызывается из локального node_modules: bunx при отсутствии пакета начал бы его скачивать.
function runNx(args: string[]): number {
  if (!existsSync(resolve(ROOT, "node_modules/.bin/nx"))) {
    process.stderr.write("verify: nx отсутствует в node_modules - выполните bun install в корне репозитория\n");
    return 1;
  }
  const result = spawnSync("node_modules/.bin/nx", args, {
    stdio: "inherit",
    cwd: ROOT,
    env: { ...process.env, NX_DAEMON: "false", NX_ISOLATE_PLUGINS: "false" },
  });
  return result.status ?? 1;
}

// Самопроверка guard (AGENTS.md §3): заведомо блокируемый payload даёт exit 2.
// Без кеша nx: шаг зависит от AGENT_RUNTIME и проверяет фактический запуск.
function guardSelfCheck(): number {
  const runtime = process.env.AGENT_RUNTIME ?? "claude";
  const result = spawnSync("bun", [".guardrails/src/cli.ts", "evaluate"], {
    cwd: ROOT,
    input: '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}',
    encoding: "utf8",
    env: { ...process.env, AGENT_RUNTIME: runtime, AGENT_RUNTIME_CONFIG: `.agents/runtime/${runtime}/config.json` },
  });
  if (result.status === 2) return 0;
  process.stderr.write(`guard self-check: ожидался exit 2, получен ${result.status}\n`);
  return 1;
}

const FAST: Step[] = [
  { name: "guardrails check", run: () => spawnSync("bun", [".guardrails/src/cli.ts", "check"], { stdio: "inherit", cwd: ROOT }).status ?? 1 },
  { name: "guardrails tests", run: () => spawnSync("bun", ["test", "./.guardrails/tests"], { stdio: "inherit", cwd: ROOT }).status ?? 1 },
  { name: "nx run harness:test", run: () => runNx(["run", "harness:test"]) },
  { name: "nx run harness:validate", run: () => runNx(["run", "harness:validate"]) },
  { name: "guard self-check", run: guardSelfCheck },
];

const steps: Step[] =
  sub === "verify-integration"
    ? [
        {
          name: "nx run-many test,validate (console, harness, guardrails)",
          run: () => runNx(["run-many", "-t", "test,validate", "-p", "console,harness,@harness/guardrails"]),
        },
        { name: "guard self-check", run: guardSelfCheck },
      ]
    : sub === "verify-security"
      ? [
          { name: "guardrails check", run: () => spawnSync("bun", [".guardrails/src/cli.ts", "check"], { stdio: "inherit", cwd: ROOT }).status ?? 1 },
          { name: "guardrails tests", run: () => spawnSync("bun", ["test", "./.guardrails/tests"], { stdio: "inherit", cwd: ROOT }).status ?? 1 },
          { name: "guardrails content scan", run: () => spawnSync("bash", ["-c", "git diff HEAD -- . ':(exclude).guardrails/rules' ':(exclude).guardrails/generated' ':(exclude).guardrails/tests' ':(exclude).guardrails/src/content' | bun .guardrails/src/cli.ts scan-diff"], { stdio: "inherit", cwd: ROOT }).status ?? 1 },
          { name: "guard self-check", run: guardSelfCheck },
        ]
      : sub === "verify-e2e"
        ? [
            { name: "nx run-many test,validate", run: () => runNx(["run-many", "-t", "test,validate"]) },
            { name: "guardrails check", run: () => spawnSync("bun", [".guardrails/src/cli.ts", "check"], { stdio: "inherit", cwd: ROOT }).status ?? 1 },
            { name: "guard self-check", run: guardSelfCheck },
          ]
        : FAST;

if (!["verify-fast", "verify-integration", "verify-security", "verify-e2e"].includes(sub)) {
  process.stderr.write(`verify: ${sub} недоступна в этом срезе репозитория\n`);
  process.exit(1);
}

for (const step of steps) {
  process.stdout.write(`[verify] ${step.name}\n`);
  const status = step.run();
  if (status !== 0) {
    process.stderr.write(`[verify] ${step.name}: не пройдено\n`);
    process.exit(status);
  }
}
process.stdout.write("[verify] ok\n");
