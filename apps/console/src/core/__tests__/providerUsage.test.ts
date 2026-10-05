import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendUsageRecords,
  applyUsageCollection,
  modelToProvider,
  providerUsageFilePath,
  providerUsageSummary,
  vendorModelIndex,
  type UsageRecord,
} from "@/core/providerUsage";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "provider-usage-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function record(provider: string, totalTokens: number, at = "2026-10-01T10:00:00.000Z"): UsageRecord {
  return { at, source: "provider-run", provider, model: "test-model", kind: "prompt-run", inputTokens: totalTokens, outputTokens: 0, totalTokens };
}

describe("provider-usage.json", () => {
  test("append агрегирует totals по провайдеру и модели, days по дню", async () => {
    await appendUsageRecords(dir, [record("gigachat", 100), record("gigachat", 50), record("anthropic", 7)]);
    const summary = await providerUsageSummary(dir);
    expect(summary.totals.gigachat.calls).toBe(2);
    expect(summary.totals.gigachat.totalTokens).toBe(150);
    expect(summary.totals.gigachat.models["test-model"].calls).toBe(2);
    expect(summary.totals.anthropic.totalTokens).toBe(7);
    expect(summary.days["2026-10-01"].gigachat).toBe(150);
    expect(summary.records).toHaveLength(3);
  });

  test("applyUsageCollection объединяет курсоры и кумулятивы одной записью", async () => {
    await applyUsageCollection(dir, {
      records: [record("runtime:codex", 200, "2026-09-30T10:00:00.000Z")],
      cursors: { "claude:/tmp/a.jsonl": 1234 },
      cumulative: { "codex:/tmp/b.jsonl": { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    });
    const raw = JSON.parse(await readFile(providerUsageFilePath(dir), "utf8"));
    expect(raw.cursors["claude:/tmp/a.jsonl"]).toBe(1234);
    expect(raw.cumulative["codex:/tmp/b.jsonl"].totalTokens).toBe(15);
    expect(raw.totals["runtime:codex"].totalTokens).toBe(200);
    expect(raw.days["2026-09-30"]["runtime:codex"]).toBe(200);
  });

  test("хвост записей ограничен, старые дни отрезаются", async () => {
    const small = await mkdtemp(join(tmpdir(), "provider-usage-limit-"));
    try {
      const many: UsageRecord[] = [];
      for (let i = 0; i < 2100; i += 1) {
        // 100 разных дней: каждая десятая запись - следующий день, начиная с 2025-01-01
        const day = new Date(Date.parse("2025-01-01T00:00:00Z") + Math.floor(i / 10) * 86_400_000);
        many.push(record("stress", 1, day.toISOString()));
      }
      await appendUsageRecords(small, many);
      const raw = JSON.parse(await readFile(providerUsageFilePath(small), "utf8"));
      expect(raw.records.length).toBeLessThanOrEqual(2000);
      expect(Object.keys(raw.days).length).toBeLessThanOrEqual(90);
    } finally {
      await rm(small, { recursive: true, force: true });
    }
  });
});

describe("атрибуция модель -> провайдер", () => {
  test("пресеты, конфиги рантаймов и отсутствие совпадения", async () => {
    const root = await mkdtemp(join(tmpdir(), "vendor-index-"));
    try {
      await mkdir(join(root, ".agents", "runtime", "fakevendor"), { recursive: true });
      await writeFile(
        join(root, ".agents", "runtime", "fakevendor", "config.json"),
        JSON.stringify({ models: { fast: { model: "FakeModel-X" } } }),
        "utf8",
      );
      const index = await vendorModelIndex(root);
      expect(modelToProvider("claude-sonnet-5-5", index)).toBe("anthropic");
      expect(modelToProvider("FakeModel-X", index)).toBe("runtime:fakevendor");
      expect(modelToProvider("unknown-model", index)).toBe(null);
      expect(modelToProvider("", index)).toBe(null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
