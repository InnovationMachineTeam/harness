import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { firstPipelineToken, graphifyGuardRead, graphifyGuardSearch } from "../indexes/graphify";
import { makeRoot, stubDeps } from "./helpers";

function bashInput(command: string, sessionId = "s1") {
  return { raw: JSON.stringify({ tool_name: "Bash", tool_input: { command }, session_id: sessionId }), input: { tool_name: "Bash", tool_input: { command }, session_id: sessionId } };
}

describe("graphify guard-search (G-1)", () => {
  test("grep первым в конвейере - срабатывает", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const { raw, input } = bashInput("grep -rn foo src/");
    const outcome = graphifyGuardSearch(root, raw, input, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toEqual([{ cmd: "graphify", args: ["hook-guard", "search"] }]);
  });

  test("ps aux | grep x - молчит", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const { raw, input } = bashInput("ps aux | grep node");
    const outcome = graphifyGuardSearch(root, raw, input, deps);
    expect(outcome.fired).toBe(false);
    expect(deps.calls).toEqual([]);
  });

  test.each([
    ["rg pattern src/", true],
    ["ag pattern", true],
    ["find . -name x", true],
    ["cat file | grep x", false],
    ["git status | grep modified", false],
    ["FOO=1 grep -rn x .", true],
    ["cd src && grep -rn x .", false],
    ["graphify query как устроен рантайм", false],
  ])("%s - %s", async (command, expected) => {
    const root = await makeRoot();
    const deps = stubDeps();
    const { raw, input } = bashInput(command);
    const outcome = graphifyGuardSearch(root, raw, input, deps);
    expect(outcome.fired).toBe(expected);
  });

  test("tool Grep - срабатывает", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const raw = JSON.stringify({ tool_name: "Grep", tool_input: { pattern: "x" } });
    const outcome = graphifyGuardSearch(root, raw, { tool_name: "Grep", tool_input: { pattern: "x" } }, deps);
    expect(outcome.fired).toBe(true);
  });

  test("другой инструмент - молчит", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const raw = JSON.stringify({ tool_name: "Read", tool_input: { file_path: "a.ts" } });
    const outcome = graphifyGuardSearch(root, raw, { tool_name: "Read", tool_input: { file_path: "a.ts" } }, deps);
    expect(outcome.fired).toBe(false);
  });
});

describe("graphify guard-read (G-2)", () => {
  test("первое чтение - срабатывает, девять следующих - молчат, одиннадцатое - срабатывает", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    let fired = 0;
    for (let n = 1; n <= 11; n += 1) {
      const raw = JSON.stringify({ tool_name: "Read", tool_input: { file_path: `f${n}.ts` }, session_id: "s1" });
      const outcome = graphifyGuardRead(root, raw, { tool_name: "Read", tool_input: { file_path: `f${n}.ts` }, session_id: "s1" }, deps);
      if (outcome.fired) fired += 1;
    }
    expect(fired).toBe(2);
  });

  test("после graphify query в сессии - молчит", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const query = bashInput('graphify query "где обрабатываются хуки?"');
    expect(graphifyGuardSearch(root, query.raw, query.input, deps).fired).toBe(false);
    const raw = JSON.stringify({ tool_name: "Read", tool_input: { file_path: "f.ts" }, session_id: "s1" });
    for (let n = 1; n <= 3; n += 1) {
      const outcome = graphifyGuardRead(root, raw, { tool_name: "Read", tool_input: { file_path: "f.ts" }, session_id: "s1" }, deps);
      expect(outcome.fired).toBe(false);
    }
    expect(deps.calls).toEqual([]);
  });

  test("чтения другой сессии считаются отдельно", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const first = { tool_name: "Read", tool_input: { file_path: "f.ts" }, session_id: "a" };
    const second = { tool_name: "Read", tool_input: { file_path: "f.ts" }, session_id: "b" };
    expect(graphifyGuardRead(root, JSON.stringify(first), first, deps).fired).toBe(true);
    expect(graphifyGuardRead(root, JSON.stringify(second), second, deps).fired).toBe(true);
  });
});

describe("firstPipelineToken", () => {
  test.each([
    ["grep -rn x .", "grep"],
    ["ps aux | grep x", "ps"],
    ["FOO=1 rg x", "rg"],
    ["cd /tmp && ls", "cd"],
  ])("%s -> %s", (command, expected) => {
    expect(firstPipelineToken(command)).toBe(expected);
  });
});
