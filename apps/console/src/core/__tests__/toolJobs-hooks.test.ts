import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startToolJob } from "../toolJobs";

async function makeFakeInstaller(dir: string, body: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, "graphify");
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return dir;
}

describe("защита файлов хуков при установке (N-5)", () => {
  test("установщик, переписавший .claude/settings.json, откатывается к исходному содержимому", async () => {
    const root = await mkdtemp(join(tmpdir(), "tooljobs-hooks-"));
    const binDir = await mkdtemp(join(tmpdir(), "tooljobs-bin-"));
    try {
      await mkdir(join(root, ".claude"), { recursive: true });
      const original = JSON.stringify({ hooks: { PreToolUse: [] } }, null, 2) + "\n";
      await writeFile(join(root, ".claude/settings.json"), original);
      // установщик переписывает файл и создаёт лишний хук-файл
      await makeFakeInstaller(binDir, `printf '{"rewritten":true}' > .claude/settings.json`);

      const savedPath = process.env.PATH;
      process.env.PATH = [binDir, savedPath].filter(Boolean).join(":");
      const exitCode = await new Promise<number | null>((resolveDone) => {
        startToolJob({
          toolId: "graphify",
          action: "install",
          defaultCwd: root,
          steps: [{ label: "Интеграция: claude", command: ["graphify", "install", "--project"] }],
          onDone: resolveDone,
        });
      });
      process.env.PATH = savedPath;

      expect(exitCode).toBe(0);
      expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(binDir, { recursive: true, force: true });
    }
  }, 20000);

  test("шаги прочих инструментов файлы хуков не трогают", async () => {
    const root = await mkdtemp(join(tmpdir(), "tooljobs-hooks-"));
    const binDir = await mkdtemp(join(tmpdir(), "tooljobs-bin-"));
    try {
      await mkdir(join(root, ".claude"), { recursive: true });
      const original = '{"hooks":{}}\n';
      await writeFile(join(root, ".claude/settings.json"), original);
      await makeFakeInstaller(binDir, `true`);

      const savedPath = process.env.PATH;
      process.env.PATH = [binDir, savedPath].filter(Boolean).join(":");
      const exitCode = await new Promise<number | null>((resolveDone) => {
        startToolJob({
          toolId: "unknown-tool",
          action: "install",
          defaultCwd: root,
          steps: [{ label: "Интеграция: claude", command: ["missing-tool-xyz", "init"] }],
          onDone: resolveDone,
        });
      });
      process.env.PATH = savedPath;

      expect(exitCode).not.toBe(0); // rtk в PATH нет - шаг падает, файл не важен
      expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(binDir, { recursive: true, force: true });
    }
  }, 20000);
});
