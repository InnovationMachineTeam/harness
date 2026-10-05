import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exceptionMatches, findException, loadExceptions, parseException } from "../src/exceptions/loader";

const VALID = JSON.stringify({
  id: "EX-2026-001",
  ruleId: "content.write-pii",
  reason: "Тестовая фикстура контактов содержит реальные адреса по требованию теста.",
  approvedBy: "stanislavus",
  expiresAt: "2099-01-01T00:00:00.000Z",
  scope: { tools: ["Write", "Edit"], pathPattern: "tests/fixtures/contacts" },
});

function repoWith(exceptions: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "guardrails-exc-"));
  if (exceptions.length) {
    mkdirSync(join(root, ".guardrails", "exceptions"), { recursive: true });
    exceptions.forEach((raw, index) => writeFileSync(join(root, ".guardrails", "exceptions", `EX-2026-00${index + 1}.json`), raw));
  }
  return root;
}

test("parseException принимает корректную запись и отвергает неполные", () => {
  expect(parseException(VALID, "EX-2026-001.json").exception?.id).toBe("EX-2026-001");
  expect(parseException("{\"id\": \"x\"}", "bad.json").error).toContain("ruleId");
  expect(parseException("not-json", "bad.json").error).toContain("JSON");
  expect(parseException(JSON.stringify({ ...JSON.parse(VALID), id: "WRONG" }), "bad.json").error).toContain("EX-YYYY-NNNN");
});

test("loadExceptions разделяет активные, просроченные и битые", () => {
  const expired = JSON.stringify({ ...JSON.parse(VALID), id: "EX-2026-002", expiresAt: "2020-01-01T00:00:00.000Z" });
  const result = loadExceptions(repoWith([VALID, expired, "{"]));
  expect(result.active).toHaveLength(1);
  expect(result.expired).toHaveLength(1);
  expect(result.errors).toHaveLength(1);
});

test("каталог без исключений и без каталога дают пустой набор", () => {
  expect(loadExceptions(repoWith([]))).toMatchObject({ active: [], expired: [], errors: [] });
  expect(loadExceptions(mkdtempSync(join(tmpdir(), "guardrails-exc-empty-"))).active).toHaveLength(0);
});

test("exceptionMatches учитывает ruleId и scope", () => {
  const exception = parseException(VALID, "x").exception!;
  expect(exceptionMatches(exception, { ruleId: "content.write-pii", tool: "Write", path: "tests/fixtures/contacts/a.md" })).toBe(true);
  expect(exceptionMatches(exception, { ruleId: "content.write-secret-value", tool: "Write", path: "tests/fixtures/contacts/a.md" })).toBe(false);
  expect(exceptionMatches(exception, { ruleId: "content.write-pii", tool: "Bash", path: "tests/fixtures/contacts/a.md" })).toBe(false);
  expect(exceptionMatches(exception, { ruleId: "content.write-pii", tool: "Write", path: "docs/contacts.md" })).toBe(false);
});

test("findException находит активное исключение и игнорирует просроченное", () => {
  const root = repoWith([VALID, JSON.stringify({ ...JSON.parse(VALID), id: "EX-2026-002", expiresAt: "2020-01-01T00:00:00.000Z" })]);
  const target = { ruleId: "content.write-pii", tool: "Write", path: "tests/fixtures/contacts/a.md" };
  expect(findException(root, target)?.id).toBe("EX-2026-001");
  expect(findException(repoWith([]), target)).toBeNull();
});
