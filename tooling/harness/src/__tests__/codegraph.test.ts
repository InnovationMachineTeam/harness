import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { codegraphPromptHook } from "../indexes/codegraph";
import { makeRoot, putIn, stubDeps } from "./helpers";

const STRUCTURAL = "Как устроена архитектура консоли и где обрабатываются рантаймы?";

async function rootWithIndex(): Promise<string> {
  const root = await makeRoot();
  await putIn(root, ".codegraph/codegraph.db");
  return root;
}

describe("codegraph prompt-hook (C-2)", () => {
  test("структурный вопрос - срабатывает", async () => {
    const root = await rootWithIndex();
    const deps = stubDeps();
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: STRUCTURAL }), { prompt: STRUCTURAL }, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toEqual([{ cmd: "codegraph", args: ["prompt-hook"] }]);
  });

  test("<bash-input> - молчит", async () => {
    const root = await rootWithIndex();
    const deps = stubDeps();
    const prompt = "<bash-input>ls -la</bash-input>\n<bash-stdout>exit 1</bash-stdout>";
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt }), { prompt }, deps);
    expect(outcome).toEqual({ output: "", fired: false, childExit: 0 });
    expect(deps.calls).toEqual([]);
  });

  test("<task-notification> - молчит", async () => {
    const root = await rootWithIndex();
    const deps = stubDeps();
    const prompt = "<task-notification>задача завершена</task-notification>";
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt }), { prompt }, deps);
    expect(outcome.fired).toBe(false);
    expect(deps.calls).toEqual([]);
  });

  test("промпт короче 15 символов - молчит", async () => {
    const root = await rootWithIndex();
    const deps = stubDeps();
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: "продолжай" }), { prompt: "продолжай" }, deps);
    expect(outcome.fired).toBe(false);
    expect(deps.calls).toEqual([]);
  });

  test("без индекса .codegraph - молчит", async () => {
    const root = await makeRoot();
    const deps = stubDeps();
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: STRUCTURAL }), { prompt: STRUCTURAL }, deps);
    expect(outcome.fired).toBe(false);
    expect(deps.calls).toEqual([]);
  });
});

describe("codegraph prompt-hook (C-3, C-1)", () => {
  test("writer.pid с живым PID - одна строка вместо контекста, ребёнок не запускается", async () => {
    const root = await rootWithIndex();
    await putIn(root, ".codegraph/writer.pid", `${process.pid}\n`);
    const deps = stubDeps();
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: STRUCTURAL }), { prompt: STRUCTURAL }, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toEqual([]);
    expect(outcome.output).toContain(`PID ${process.pid}`);
    expect(outcome.output.split("\n").filter(Boolean).length).toBe(1);
  });

  test("writer.pid с мёртвым PID - ребёнок запускается", async () => {
    const root = await rootWithIndex();
    await putIn(root, ".codegraph/writer.pid", "999999999\n");
    const deps = stubDeps();
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: STRUCTURAL }), { prompt: STRUCTURAL }, deps);
    expect(outcome.fired).toBe(true);
    expect(deps.calls).toEqual([{ cmd: "codegraph", args: ["prompt-hook"] }]);
  });

  test("вывод больше 4 КБ обрезается с подписью", async () => {
    const root = await rootWithIndex();
    const big = "x".repeat(9000);
    const deps = stubDeps({ stdout: big });
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: STRUCTURAL }), { prompt: STRUCTURAL }, deps);
    expect(outcome.fired).toBe(true);
    expect(Buffer.byteLength(outcome.output, "utf8")).toBeLessThan(4600);
    expect(outcome.output).toContain("call codegraph_explore for the rest");
  });

  test("пустой вывод ребёнка - молчит", async () => {
    const root = await rootWithIndex();
    const deps = stubDeps({ stdout: "   \n" });
    const outcome = codegraphPromptHook(root, JSON.stringify({ prompt: STRUCTURAL }), { prompt: STRUCTURAL }, deps);
    expect(outcome.fired).toBe(false);
  });
});
