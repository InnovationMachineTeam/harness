import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { preToolUseAll } from "../indexes/pretooluse";
import { makeRoot, putIn, stubDeps } from "./helpers";

function input(tool: string, extra: Record<string, unknown> = {}, sessionId = "agg1") {
  return { raw: JSON.stringify({ tool_name: tool, tool_input: extra, session_id: sessionId }), value: { tool_name: tool, tool_input: extra, session_id: sessionId } };
}

async function rootWithSerena(): Promise<string> {
  const root = await makeRoot();
  await putIn(root, ".serena/project.yml", "name: test\n");
  const big = Array.from({ length: 301 }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n";
  await putIn(root, "big.ts", big);
  return root;
}

describe("агрегатор pretooluse (Cursor)", () => {
  test("Read - guard-read и serena remind, вывод объединяется", async () => {
    const root = await rootWithSerena();
    const deps = stubDeps({ stdout: "CHILD-OUT\n" });
    const { raw, value } = input("Read", { file_path: join(root, "big.ts") });
    const outcome = preToolUseAll(root, raw, value, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toHaveLength(2);
    expect(deps.calls[0].cmd).toBe("graphify");
    expect(deps.calls[1].cmd).toBe("serena-hooks");
    expect(outcome.output).toContain("CHILD-OUT");
    expect(outcome.output).toContain("\n");
  });

  test("Bash - только guard-search; после pipe - молчит", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const fired = input("Bash", { command: "grep -rn x ." });
    const outcome = preToolUseAll(root, fired.raw, fired.value, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toEqual([{ cmd: "graphify", args: ["hook-guard", "search"] }]);

    const silent = input("Bash", { command: "ps aux | grep x" }, "agg2");
    expect(preToolUseAll(root, silent.raw, silent.value, deps).fired).toBe(false);
  });

  test("Write - молчит, детей нет", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const { raw, value } = input("Write", { file_path: "a.ts" });
    expect(preToolUseAll(root, raw, value, deps)).toEqual({ output: "", fired: false, childExit: 0 });
    expect(deps.calls).toEqual([]);
  });

  test("Glob - только guard-read", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const { raw, value } = input("Glob", { pattern: "**/*.ts" });
    preToolUseAll(root, raw, value, deps);
    expect(deps.calls).toEqual([{ cmd: "graphify", args: ["hook-guard", "read", "--strict"] }]);
  });
});
