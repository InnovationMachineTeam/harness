import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { serenaRemind, serenaSessionEnd, serenaSessionStart } from "../indexes/serena";
import { makeRoot, putIn, stubDeps } from "./helpers";

async function rootWithSerena(): Promise<string> {
  const root = await makeRoot();
  await putIn(root, ".serena/project.yml", "name: test\n");
  return root;
}

function tsFile(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n";
}

describe("serena remind (S-2)", () => {
  test(".ts больше 300 строк - срабатывает один раз за сессию", async () => {
    const root = await rootWithSerena();
    const filePath = join(root, "big.ts");
    await putIn(root, "big.ts", tsFile(301));
    const deps = stubDeps({ stdout: "" });
    const input = { tool_name: "Read", tool_input: { file_path: filePath }, session_id: "s1" };
    const first = serenaRemind(root, JSON.stringify(input), input, deps);
    expect(first.fired).toBe(true);
    expect(first.output).toContain("get_symbols_overview");
    const second = serenaRemind(root, JSON.stringify(input), input, deps);
    expect(second.fired).toBe(false);
  });

  test(".ts ровно 300 строк - молчит", async () => {
    const root = await rootWithSerena();
    const filePath = join(root, "ok.ts");
    await putIn(root, "ok.ts", tsFile(300));
    const deps = stubDeps({ stdout: "" });
    const input = { tool_name: "Read", tool_input: { file_path: filePath }, session_id: "s2" };
    expect(serenaRemind(root, JSON.stringify(input), input, deps).fired).toBe(false);
  });

  test(".md больше 300 строк - молчит", async () => {
    const root = await rootWithSerena();
    const filePath = join(root, "big.md");
    await putIn(root, "big.md", tsFile(400));
    const deps = stubDeps({ stdout: "" });
    const input = { tool_name: "Read", tool_input: { file_path: filePath }, session_id: "s3" };
    expect(serenaRemind(root, JSON.stringify(input), input, deps).fired).toBe(false);
  });

  test("Grep по каталогу - молчит, Grep по крупному .ts - срабатывает", async () => {
    const root = await rootWithSerena();
    await putIn(root, "big.ts", tsFile(301));
    const deps = stubDeps({ stdout: "" });
    const dir = { tool_name: "Grep", tool_input: { path: root }, session_id: "s4" };
    expect(serenaRemind(root, JSON.stringify(dir), dir, deps).fired).toBe(false);
    const file = { tool_name: "Grep", tool_input: { path: join(root, "big.ts") }, session_id: "s5" };
    expect(serenaRemind(root, JSON.stringify(file), file, deps).fired).toBe(true);
  });

  test("без .serena/project.yml - молчит", async () => {
    const root = await makeRoot();
    const filePath = join(root, "big.ts");
    await putIn(root, "big.ts", tsFile(301));
    const deps = stubDeps({ stdout: "" });
    const input = { tool_name: "Read", tool_input: { file_path: filePath }, session_id: "s6" };
    expect(serenaRemind(root, JSON.stringify(input), input, deps).fired).toBe(false);
  });

  test("вывод serena-hooks remind пересылается как есть", async () => {
    const root = await rootWithSerena();
    const filePath = join(root, "big.ts");
    await putIn(root, "big.ts", tsFile(301));
    const deps = stubDeps({ stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse" } }) });
    const input = { tool_name: "Read", tool_input: { file_path: filePath }, session_id: "s7" };
    const outcome = serenaRemind(root, JSON.stringify(input), input, deps);
    expect(outcome.fired).toBe(true);
    expect(outcome.output).toContain("hookSpecificOutput");
  });
});

describe("serena session-start (S-1)", () => {
  test("проиндексированный проект и serena-hooks - вывод activate", async () => {
    const root = await rootWithSerena();
    const deps = stubDeps({ stdout: '{"hookSpecificOutput":{"hookEventName":"SessionStart"}}' });
    const outcome = serenaSessionStart(root, "{}", {}, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toEqual([{ cmd: "serena-hooks", args: ["activate"] }]);
  });

  test("нет serena-hooks, есть serena - встроенная подсказка", async () => {
    const root = await rootWithSerena();
    const deps = stubDeps();
    deps.commandExists = (cmd) => cmd === "serena";
    const outcome = serenaSessionStart(root, "{}", {}, deps);
    expect(outcome.fired).toBe(true);
    expect(outcome.output).toContain("activate_project");
  });

  test("нет проекта - молчит", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    expect(serenaSessionStart(root, "{}", {}, deps).fired).toBe(false);
    expect(deps.calls).toEqual([]);
  });

  test("session-end вызывает cleanup без вывода", async () => {
    const root = await rootWithSerena();
    const deps = stubDeps({ stdout: "cleanup done" });
    const outcome = serenaSessionEnd(root, "{}", {}, deps);
    expect(outcome.fired).toBe(false);
    expect(deps.calls).toEqual([{ cmd: "serena-hooks", args: ["cleanup"] }]);
  });
});
