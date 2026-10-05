import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLifecycleHook } from "@/core/lifecycleHooks";

let repoRoot = "";
let workspace = "";

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "lifecycle-hooks-repo-"));
  workspace = await mkdtemp(join(tmpdir(), "lifecycle-hooks-ws-"));
  // подменный guard: команды с BLOCKED отклоняются (exit 2), остальные - разрешены
  await mkdir(join(repoRoot, ".guardrails", "src"), { recursive: true });
  await writeFile(
    join(repoRoot, ".guardrails", "src", "cli.ts"),
    [
      "let raw = '';",
      'process.stdin.on("data", (c) => { raw += c; });',
      'process.stdin.on("end", () => {',
      "  const payload = JSON.parse(raw || '{}');",
      '  if (String(payload?.tool_input?.command || "").includes("BLOCKED")) {',
      '    process.stderr.write("BLOCKED by test guard");',
      "    process.exit(2);",
      "  }",
      "  process.exit(0);",
      "});",
    ].join("\n"),
    "utf8",
  );
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("runLifecycleHook", () => {
  test("разрешённая команда исполняется в обязательной рабочей папке и попадает в лог", async () => {
    const outcome = await runLifecycleHook({
      repoRoot,
      workspace,
      domain: "tool",
      name: "demo",
      op: "install",
      hooks: { install: ["printf yes > hook-cwd-marker"], remove: [], enable: [], disable: [] },
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.done.length).toBe(1);
    expect(existsSync(join(workspace, "hook-cwd-marker"))).toBe(true);
    const log = await readFile(join(repoRoot, ".agents", "console", "hooks", "tool.log"), "utf8");
    expect(log).toContain("install demo");
  });

  test("команда, отклонённая guard, не исполняется и уходит в errors", async () => {
    const outcome = await runLifecycleHook({
      repoRoot,
      workspace,
      domain: "mcp",
      name: "demo",
      op: "enable",
      hooks: { install: [], remove: [], enable: ["echo BLOCKED"], disable: [] },
    });
    expect(outcome.done).toEqual([]);
    expect(outcome.errors.length).toBe(1);
    expect(outcome.errors[0]).toContain("guard");
  });

  test("пустые хуки - ни одной команды", async () => {
    const outcome = await runLifecycleHook({
      repoRoot,
      workspace,
      domain: "plugin",
      name: "demo",
      op: "disable",
      hooks: undefined,
    });
    expect(outcome.done).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });
});
