import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChild } from "../lib/child";
import { putIn } from "./helpers";

const STRUCTURAL = "Как устроена архитектура консоли и где обрабатываются рантаймы?";

function envWith(root: string, pathDir: string): NodeJS.ProcessEnv {
  const pathEntries = [pathDir, process.env.PATH].filter(Boolean);
  return { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: pathEntries.join(":") };
}

async function makeFakeBin(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "harness-fakebin-"));
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return dir;
}

describe("запуск через cli.ts при сломанном бинарнике (приёмка 4)", () => {
  const roots: string[] = [];

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  test("codegraph завершается с ошибкой - хук exit 0 без вывода", async () => {
    const binDir = await makeFakeBin("codegraph", "exit 1");
    const root = await mkdtemp(join(tmpdir(), "harness-cliroot-"));
    roots.push(binDir, root);
    await putIn(root, ".codegraph/codegraph.db");
    const result = spawnSync("bun", [join(import.meta.dir, "../../src/cli.ts"), "codegraph", "prompt-hook"], {
      input: JSON.stringify({ prompt: STRUCTURAL, session_id: "cli1" }),
      encoding: "utf8",
      env: envWith(root, binDir),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  test("graphify зависает - хук прерывается по таймауту и завершается с кодом 0", async () => {
    const binDir = await makeFakeBin("graphify", "sleep 30");
    const root = await mkdtemp(join(tmpdir(), "harness-cliroot-"));
    roots.push(binDir, root);
    const result = spawnSync("bun", [join(import.meta.dir, "../../src/cli.ts"), "graphify", "guard-search"], {
      input: JSON.stringify({ tool_name: "Grep", tool_input: { pattern: "x" }, session_id: "cli2" }),
      encoding: "utf8",
      env: envWith(root, binDir),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  }, 20000);

  test("бинарник отсутствует - хук exit 0", async () => {
    const emptyBin = await mkdtemp(join(tmpdir(), "harness-emptybin-"));
    const root = await mkdtemp(join(tmpdir(), "harness-cliroot-"));
    roots.push(emptyBin, root);
    await putIn(root, ".serena/project.yml", "name: test\n");
    const pathEntries = (process.env.PATH ?? "").split(":").filter((entry) => entry && !entry.includes(".local/bin"));
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: [emptyBin, ...pathEntries].join(":") };
    const result = spawnSync("bun", [join(import.meta.dir, "../../src/cli.ts"), "serena", "session-start"], {
      input: JSON.stringify({ session_id: "cli3" }),
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(0);
  });

  test("runChild прерывает зависшего ребёнка по таймауту", async () => {
    const binDir = await makeFakeBin("graphify", "sleep 30");
    const savedPath = process.env.PATH;
    process.env.PATH = `${binDir}:${savedPath}`;
    try {
      const started = Date.now();
      const child = runChild("graphify", ["x"], { timeoutMs: 150 });
      expect(child.timedOut).toBe(true);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      process.env.PATH = savedPath;
    }
  }, 10000);
});
