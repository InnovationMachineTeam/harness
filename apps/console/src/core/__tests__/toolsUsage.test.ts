import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateUsage, appendUsageEvent, collectUsage, usageFilePath } from "@/core/toolsUsage";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "tools-usage-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("tools-usage.json", () => {
  test("append пишет события в отдельный файл; агрегат считает по инструментам", async () => {
    await appendUsageEvent(dir, { tool: "graphify", action: "install", runtimes: ["claude", "codex"] });
    await appendUsageEvent(dir, { tool: "graphify", action: "build" });
    await appendUsageEvent(dir, { tool: "rtk", action: "toggle", detail: "off" });

    const raw = JSON.parse(await readFile(usageFilePath(dir), "utf8"));
    expect(raw.events).toHaveLength(3);
    expect(raw.events[0].tool).toBe("graphify");

    const agg = aggregateUsage(raw.events);
    expect(agg.graphify.total).toBe(2);
    expect(agg.graphify.byAction.build).toBe(1);
    expect(agg.rtk.total).toBe(1);
    expect(agg.graphify.lastAt).toBeTruthy();
  });

  test("collectUsage читает файл, не падая без внешних инструментов", async () => {
    const usage = await collectUsage(dir);
    expect(usage.events.length).toBe(3);
    expect(usage.aggregates.graphify.total).toBe(2);
    expect(Array.isArray(usage.snapshots)).toBe(true);
  });

  test("лимит событий: хвост обрезается до 1000", async () => {
    const small = await mkdtemp(join(tmpdir(), "tools-usage-limit-"));
    try {
      for (let i = 0; i < 1003; i += 1) {
        await appendUsageEvent(small, { tool: "qmd", action: "index" });
      }
      const raw = JSON.parse(await readFile(usageFilePath(small), "utf8"));
      expect(raw.events).toHaveLength(1000);
    } finally {
      await rm(small, { recursive: true, force: true });
    }
  });
});
