import { expect, test } from "bun:test";

const run = (input: string) => Bun.spawnSync(["bun", ".guardrails/src/cli.ts", "evaluate"], { cwd: process.cwd(), stdin: Buffer.from(input), env: { ...process.env, GUARDRAILS_INTEGRATION: "test:cli" } });

test("CLI разрешает безопасный payload", () => expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } })).exitCode).toBe(0));
test("CLI блокирует опасный payload", () => expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } })).exitCode).toBe(2));
test("CLI закрывается при повреждённом payload", () => expect(run("not-json").exitCode).toBe(2));
