import { describe, expect, test } from "bun:test";
import { hookBudgetReport, parseLog } from "../doctor";
import { makeRoot, putIn } from "./helpers";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("doctor hook-budget (N-4)", () => {
  test("строки журнала разбираются", () => {
    const rows = parseLog("2026-10-01T10:00:00.000Z codegraph/prompt-hook 120 889 exit=0\nмусор\n");
    expect(rows).toEqual([{ iso: "2026-10-01T10:00:00.000Z", name: "codegraph/prompt-hook", ms: 120, bytes: 889 }]);
  });

  test("хуки в бюджете - список пуст", async () => {
    const root = await makeRoot();
    const log = [
      `${isoDaysAgo(1)} codegraph/prompt-hook 300 800 exit=0`,
      `${isoDaysAgo(1)} graphify/guard-search 15 220 exit=0`,
      `${isoDaysAgo(2)} serena/session-start 500 150 exit=0`,
    ].join("\n");
    await putIn(root, ".agents/.tmp/hooks/hooks.log", log);
    expect(hookBudgetReport(root)).toEqual([]);
  });

  test("хук сверх бюджета - строка с именем и числами", async () => {
    const root = await makeRoot();
    const log = [
      `${isoDaysAgo(1)} codegraph/prompt-hook 9000 800 exit=0`,
      `${isoDaysAgo(1)} codegraph/prompt-hook 5000 800 exit=0`,
    ].join("\n");
    await putIn(root, ".agents/.tmp/hooks/hooks.log", log);
    const problems = hookBudgetReport(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("codegraph/prompt-hook");
    expect(problems[0]).toContain("7000");
  });

  test("вывод выше 4 КБ у prompt-hook - нарушение по байтам", async () => {
    const root = await makeRoot();
    await putIn(root, ".agents/.tmp/hooks/hooks.log", `${isoDaysAgo(0)} codegraph/prompt-hook 100 9300 exit=0`);
    const problems = hookBudgetReport(root);
    expect(problems.some((line) => line.includes("bytes"))).toBe(true);
  });

  test("записи старше 7 дней не учитываются", async () => {
    const root = await makeRoot();
    await putIn(root, ".agents/.tmp/hooks/hooks.log", `${isoDaysAgo(9)} codegraph/prompt-hook 9000 800 exit=0`);
    expect(hookBudgetReport(root)).toEqual([]);
  });

  test("без журнала - список пуст", async () => {
    const root = await makeRoot();
    expect(hookBudgetReport(root)).toEqual([]);
  });
});
