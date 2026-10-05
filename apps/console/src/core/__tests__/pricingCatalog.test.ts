import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  effectiveModelPrice,
  modelEntry,
  type CatalogData,
} from "@/core/pricingCatalog";
import { invalidatePricingCatalogCache, readCatalog, refreshCatalog } from "@/core/pricingCatalogServer";
import { normalizeBilling } from "@/core/state";

const TMP = path.join(process.cwd(), ".agents", ".tmp", "pricing-catalog-test");

async function writeCatalog(files: { subscriptions?: unknown; models?: unknown; sources?: unknown }): Promise<string> {
  await rm(TMP, { recursive: true, force: true });
  const dir = path.join(TMP, ".agents", "pricing");
  await mkdir(dir, { recursive: true });
  if (files.subscriptions) await writeFile(path.join(dir, "subscriptions.json"), JSON.stringify(files.subscriptions), "utf8");
  if (files.models) await writeFile(path.join(dir, "models.json"), JSON.stringify(files.models), "utf8");
  if (files.sources) await writeFile(path.join(dir, "sources.json"), JSON.stringify(files.sources), "utf8");
  invalidatePricingCatalogCache();
  return TMP;
}

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  invalidatePricingCatalogCache();
});

const MODELS = {
  updatedAt: "2026-10-03T00:00:00.000Z",
  models: {
    "model-a": {
      label: "Model A",
      prices: [
        { provider: "vendor", official: true, inputPerMtok: 2, outputPerMtok: 10, cacheReadPerMtok: 0.2 },
        { provider: "openrouter", inputPerMtok: 4, outputPerMtok: 20 },
      ],
    },
    "model-b": {
      label: "Model B",
      aliases: ["Model B (Fast)"],
      prices: [
        { provider: "vendor", inputPerMtok: 1, outputPerMtok: 2 },
        { provider: "openrouter", inputPerMtok: 3, outputPerMtok: 6 },
      ],
    },
  },
};

describe("pricingCatalog: чтение и эффективная цена", () => {
  test("average считается при чтении, официальная цена приоритетна", async () => {
    const repoRoot = await writeCatalog({ models: MODELS });
    const data = await readCatalog(repoRoot);
    const a = data.models.models["model-a"];
    expect(a.average).toEqual({ inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.2 });
    const price = effectiveModelPrice(data, "model-a");
    expect(price.origin).toBe("official");
    expect(price.inputPerMtok).toBe(2);
    expect(price.outputPerMtok).toBe(10);
  });

  test("без официальной точки берётся средняя; отсутствующая модель - none", async () => {
    const repoRoot = await writeCatalog({ models: MODELS });
    const data = await readCatalog(repoRoot);
    const price = effectiveModelPrice(data, "model-b");
    expect(price.origin).toBe("average");
    expect(price.inputPerMtok).toBe(2);
    expect(price.outputPerMtok).toBe(4);
    expect(effectiveModelPrice(data, "model-x").origin).toBe("none");
  });

  test("modelEntry находит модель по алиасу в нижнем регистре", async () => {
    const repoRoot = await writeCatalog({ models: MODELS });
    const data = await readCatalog(repoRoot);
    expect(modelEntry(data.models.models, "model-b (fast)")?.label).toBe("Model B");
    expect(modelEntry(data.models.models, "MODEL-A")?.label).toBe("Model A");
    expect(modelEntry(data.models.models, "model-unknown")).toBeUndefined();
  });
});

describe("pricingCatalog: refresh источников", () => {
  test("недоступный источник помечается unavailable, значения каталога остаются", async () => {
    const repoRoot = await writeCatalog({
      models: MODELS,
      sources: {
        recordedAt: "2026-10-03T00:00:00.000Z",
        sources: {
          "api:down": { url: "http://127.0.0.1:9/models", kind: "api", format: "json", target: "openrouter", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "2026-10-03T00:00:00.000Z" },
        },
      },
    });
    const result = await refreshCatalog(repoRoot);
    expect(result.checked).toBe(1);
    expect(result.ok).toBe(0);
    expect(result.unavailable).toHaveLength(1);
    const data = await readCatalog(repoRoot);
    expect(data.sources.sources["api:down"].status).toBe("unavailable");
    expect(data.sources.sources["api:down"].lastCheckedAt).not.toBeNull();
    // значения моделей не изменились
    expect(data.models.models["model-a"].prices).toHaveLength(2);
  });

  test("отсутствующий sources.json создаётся из источников по умолчанию", async () => {
    const repoRoot = await writeCatalog({ models: MODELS });
    const data: CatalogData = await readCatalog(repoRoot);
    expect(Object.keys(data.sources.sources)).toHaveLength(0);
  });
});

describe("state: normalizeBilling", () => {
  test("валидный выбор и пополнения сохраняются", () => {
    const billing = normalizeBilling({
      runtimes: { claude: { mode: "plan", planId: "pro" }, codex: { mode: "payg" } },
      providers: { openrouter: { mode: "payg" } },
      deposits: { "runtime:codex": [{ id: "d1", amount: 20, currency: "USD", at: "2026-10-01T00:00:00.000Z", note: "старт" }] },
    });
    expect(billing.runtimes.claude).toEqual({ mode: "plan", planId: "pro" });
    expect(billing.providers.openrouter).toEqual({ mode: "payg" });
    expect(billing.deposits["runtime:codex"]).toHaveLength(1);
  });

  test("битые записи отбрасываются: неизвестный mode, plan без planId, пополнение без суммы", () => {
    const billing = normalizeBilling({
      runtimes: { claude: { mode: "ultra" }, codex: { mode: "plan" }, kimi: { mode: "none" } },
      deposits: { "provider:x": [{ id: "d2" }, { id: "d3", amount: "20", currency: "USD", at: "2026-10-01" }, { id: "d4", amount: 5, currency: "USD", at: "не дата" }] },
    });
    expect(billing.runtimes.claude).toBeUndefined();
    expect(billing.runtimes.codex).toBeUndefined();
    expect(billing.runtimes.kimi).toEqual({ mode: "none" });
    expect(billing.deposits["provider:x"]).toHaveLength(0);
  });

  test("не-объект даёт пустую структуру", () => {
    expect(normalizeBilling(null)).toEqual({ runtimes: {}, providers: {}, deposits: {} });
    expect(normalizeBilling("plan")).toEqual({ runtimes: {}, providers: {}, deposits: {} });
  });
});
