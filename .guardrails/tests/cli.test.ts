import { expect, test } from "bun:test";

const run = (input: string) => Bun.spawnSync(["bun", ".guardrails/src/cli.ts", "evaluate"], { cwd: process.cwd(), stdin: Buffer.from(input), env: { ...process.env, GUARDRAILS_INTEGRATION: "test:cli" } });

test("CLI разрешает безопасный payload", () => expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } })).exitCode).toBe(0));
test("CLI блокирует опасный payload", () => expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } })).exitCode).toBe(2));
test("CLI закрывается при повреждённом payload", () => expect(run("not-json").exitCode).toBe(2));

test("context отдаёт машиночитаемые настройки рантайма", () => {
  const run = Bun.spawnSync(["bun", ".guardrails/src/cli.ts", "context"], { cwd: process.cwd(), env: { ...process.env, AGENT_RUNTIME: "zcode", GUARDRAILS_INTEGRATION: "test:cli" } });
  expect(run.exitCode).toBe(0);
  const data = JSON.parse(run.stdout.toString()) as Record<string, any>;
  expect(data.runtime).toBe("zcode");
  expect(data.profile.name).toBe("default");
  expect(Array.isArray(data.models)).toBe(true);
  expect(data.models.length).toBeGreaterThan(0);
  expect(typeof data.limits.repairAttempts).toBe("number");
  expect(typeof data.verification.fast).toBe("string");
});
