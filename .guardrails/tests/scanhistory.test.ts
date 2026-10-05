import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstMatch, parseShowOutput } from "../src/scanhistory";

const run = (args: string[], cwd: string) =>
  Bun.spawnSync(["bun", join(process.cwd(), ".guardrails", "src", "scanhistory.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

function initRepo(): { root: string; secretSha: string } {
  const root = mkdtempSync(join(tmpdir(), "scanhistory-"));
  const git = (args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(proc.stderr)}`);
    return new TextDecoder().decode(proc.stdout).trim();
  };
  git(["-c", "init.defaultBranch=main", "init", "."]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test@example.test"]);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "clean.ts"), "export const retries = 3;\n");
  git(["add", "."]);
  git(["commit", "-m", "clean"]);
  writeFileSync(join(root, "src", "config.ts"), "const key = \"AKIAIOSFODNN7EXAMPLE\";\n");
  git(["add", "."]);
  git(["commit", "-m", "leak"]);
  return { root, secretSha: git(["rev-parse", "HEAD"]) };
}

test("firstMatch возвращает совпадение по id паттерна", () => {
  expect(firstMatch("pii.email", "почта ivan@example.com")).toBe("ivan@example.com");
  expect(firstMatch("secret.aws-access-key", "")).toBeUndefined();
  expect(firstMatch("no-such-pattern", "text")).toBeUndefined();
});

test("parseShowOutput разбирает hunks и находит добавленные строки", () => {
  const output = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,0 +1,2 @@",
    "+const key = \"AKIAIOSFODNN7EXAMPLE\";",
    "+export const retries = 3;",
  ].join("\n");
  const findings = parseShowOutput("abc123", output);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ sha: "abc123", file: "src/a.ts", line: 1, patternId: "secret.aws-access-key" });
});

test("артефакты Guardrails и .agents/.tmp исключаются", () => {
  const output = [
    "diff --git a/.guardrails/tests/fixtures/attacks.json b/.guardrails/tests/fixtures/attacks.json",
    "--- /dev/null",
    "+++ b/.guardrails/tests/fixtures/attacks.json",
    "@@ -0,0 +1,1 @@",
    "+const key = \"AKIAIOSFODNN7EXAMPLE\";",
    "diff --git a/.agents/.tmp/x.txt b/.agents/.tmp/x.txt",
    "--- /dev/null",
    "+++ b/.agents/.tmp/x.txt",
    "@@ -0,0 +1,1 @@",
    "+AKIAIOSFODNN7EXAMPLE",
  ].join("\n");
  expect(parseShowOutput("abc123", output)).toHaveLength(0);
});

test("скан истории: секрет найден, чистый репозиторий пуст", () => {
  const { root, secretSha } = initRepo();
  const proc = run(["--range", "HEAD", "--fail-on-secrets"], root);
  expect(proc.exitCode).toBe(2);
  const stdout = new TextDecoder().decode(proc.stdout);
  expect(stdout).toContain(secretSha.slice(0, 10));
  expect(stdout).toContain("secret.aws-access-key");
  expect(stdout).not.toContain("AKIAIOSFODNN7EXAMPLE");
});

test("скан истории: --show-values показывает персональные данные, но не секреты", () => {
  const root = initRepo().root;
  const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe" });
  writeFileSync(join(root, "src", "contact.md"), "Контакт: ivan@example.com\n");
  git(["add", "."]);
  git(["commit", "-m", "contact"]);
  const proc = run(["--range", "HEAD", "--show-values"], root);
  expect(proc.exitCode).toBe(0);
  const stdout = new TextDecoder().decode(proc.stdout);
  expect(stdout).toContain("ivan@example.com");
  expect(stdout).not.toContain("AKIAIOSFODNN7EXAMPLE");
});
