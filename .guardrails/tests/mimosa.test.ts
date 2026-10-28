import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { HOOK_STATUS_MAX_FILES, mimosaStatusDocument, pruneHookStatus, writeHookStatus } from "../src/mimosa";

test("документ статуса соответствует схеме mimosa-hook-status/v1", () => {
  const document = mimosaStatusDocument(
    { sessionId: "sess_abc", event: "PostToolUse", toolName: "Read", file: "src/a.ts", outcome: "clear", findingCount: 0, durationMs: 3 },
    "2026-10-04T12:00:00.000Z",
  );
  expect(document).toMatchObject({
    schemaVersion: "mimosa-hook-status/v1",
    sessionId: "sess_abc",
    event: "PostToolUse",
    toolName: "Read",
    file: "src/a.ts",
    outcome: "clear",
    coverage: "complete",
    findingCount: 0,
    durationMs: 3,
    hostState: "hook_complete",
    reportHint: ".guardrails/audit/events.jsonl",
  });
});

test("sessionId без префикса получает sess_", () => {
  const document = mimosaStatusDocument({ sessionId: "xyz", event: "UserPromptSubmit", outcome: "warn", findingCount: 1, durationMs: 1 });
  expect(document.sessionId).toBe("sess_xyz");
});

test("writeHookStatus создаёт файл в .mimosa/hook-status", () => {
  const root = mkdtempSync(join(tmpdir(), "mimosa-"));
  writeHookStatus(root, { sessionId: "sess_test", event: "PostToolUse", outcome: "blocked", findingCount: 1, durationMs: 5 });
  const dir = join(root, ".mimosa", "hook-status");
  expect(existsSync(dir)).toBe(true);
  const files = readdirSync(dir);
  expect(files).toHaveLength(1);
  const parsed = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
  expect(parsed.outcome).toBe("blocked");
});

test("pruneHookStatus удаляет просроченные файлы и держит предел числа", () => {
  const root = mkdtempSync(join(tmpdir(), "mimosa-prune-"));
  const dir = join(root, ".mimosa", "hook-status");
  mkdirSync(dir, { recursive: true });
  const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
  for (let index = 0; index < 20; index++) {
    const file = join(dir, `sess_old-${index}.json`);
    writeFileSync(file, "{}\n");
    utimesSync(file, expired, expired);
  }
  for (let index = 0; index < 600; index++) writeFileSync(join(dir, `sess_new-${index}.json`), "{}\n");
  pruneHookStatus(dir);
  const files = readdirSync(dir);
  expect(files).toHaveLength(HOOK_STATUS_MAX_FILES);
  expect(files.some((name) => name.startsWith("sess_old-"))).toBe(false);
});

test("pruneHookStatus не трогает каталог в пределах лимита", () => {
  const root = mkdtempSync(join(tmpdir(), "mimosa-keep-"));
  const dir = join(root, ".mimosa", "hook-status");
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < 10; index++) writeFileSync(join(dir, `sess_${index}.json`), "{}\n");
  pruneHookStatus(dir);
  expect(readdirSync(dir)).toHaveLength(10);
});
