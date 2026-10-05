import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { mimosaStatusDocument, writeHookStatus } from "../src/mimosa";

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
