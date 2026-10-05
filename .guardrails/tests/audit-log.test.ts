import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision, eventsPath, MAX_LOG_BYTES, readDecisions } from "../src/audit-log";

test("appendDecision создаёт журнал и дописывает события", () => {
  const repo = mkdtempSync(join(tmpdir(), "audit-log-"));
  appendDecision(repo, { effect: "allow", ruleId: null });
  appendDecision(repo, { effect: "block", ruleId: "shell.rm-rf-root" });
  const lines = readFileSync(eventsPath(repo), "utf8").trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(JSON.parse(lines[1]!)).toMatchObject({ effect: "block" });
});

test("ротация: файл больше предела переименовывается в .1", () => {
  const repo = mkdtempSync(join(tmpdir(), "audit-log-rot-"));
  mkdirSync(join(repo, "guardrails", "audit"), { recursive: true });
  // Готовый oversized-файл там, где его ждёт писатель.
  const target = eventsPath(repo);
  mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  writeFileSync(target, "x".repeat(MAX_LOG_BYTES + 1));
  appendDecision(repo, { effect: "warn" });
  expect(existsSync(`${target}.1`)).toBe(true);
  expect(statSync(`${target}.1`).size).toBe(MAX_LOG_BYTES + 1);
  const current = readFileSync(target, "utf8").trim().split("\n");
  expect(current).toHaveLength(1);
});

test("readDecisions читает копию и текущий файл, пропуская битые строки", () => {
  const repo = mkdtempSync(join(tmpdir(), "audit-log-read-"));
  const target = eventsPath(repo);
  mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  writeFileSync(`${target}.1`, JSON.stringify({ effect: "allow" }) + "\n");
  writeFileSync(target, JSON.stringify({ effect: "block" }) + "\n" + "not-json\n");
  const decisions = readDecisions(repo);
  expect(decisions.map((decision) => decision.effect)).toEqual(["allow", "block"]);
});

test("readDecisions на пустом каталоге возвращает пустой список", () => {
  expect(readDecisions(mkdtempSync(join(tmpdir(), "audit-log-empty-")))).toEqual([]);
});
