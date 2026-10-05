import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putIn } from "./helpers";

const WRAPPER = join(import.meta.dir, "../../../mcp/codegraph.ts");

describe("обёртка codegraph init/index (C-4)", () => {
  test("writer.pid с живым PID - exit 1 без записи в базу", async () => {
    const root = await mkdtemp(join(tmpdir(), "c4-lock-"));
    try {
      await putIn(root, ".codegraph/writer.pid", `${process.pid}\n`);
      const result = spawnSync(process.execPath, [WRAPPER, "index"], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`PID ${process.pid}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);

  test("подкоманда вне init/index - exit 2", async () => {
    const root = await mkdtemp(join(tmpdir(), "c4-sub-"));
    try {
      const result = spawnSync(process.execPath, [WRAPPER, "query", "x"], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("init");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
