import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "./repo";
import {
  computeAverage,
  type CatalogData,
  type ModelPriceEntry,
  type ModelPricePoint,
  type PricingCatalogDTO,
  type SourceRecord,
} from "./pricingCatalog";

/**
 * Каталог цен - серверная половина: чтение файлов .agents/pricing/
 * (subscriptions.json, models.json, sources.json) с TTL-кешем и обновление
 * из зафиксированных источников (refreshCatalog). Типы и расчёт эффективной
 * цены - core/pricingCatalog.ts (клиентская часть без node-импортов).
 *
 * sources.json - зафиксированные источники: первый refresh создаёт реестр из
 * DEFAULT_SOURCES и фиксирует его; далее обновление идёт только по известным
 * источникам, недоступный помечается status "unavailable", данные остаются.
 */

export function pricingDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "pricing");
}

function subscriptionsFile(repoRoot: string): string {
  return path.join(pricingDir(repoRoot), "subscriptions.json");
}

function modelsFile(repoRoot: string): string {
  return path.join(pricingDir(repoRoot), "models.json");
}

function sourcesFile(repoRoot: string): string {
  return path.join(pricingDir(repoRoot), "sources.json");
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/* ------------------------------ источники по умолчанию ------------------------------ */

/**
 * Источники первого обнаружения: если sources.json отсутствует, реестр
 * создаётся из этого списка и фиксируется на диске - дальнейшие refresh
 * идут только по зафиксированным источникам.
 */
const DEFAULT_SOURCES: Record<string, SourceRecord> = {
  "api:openrouter": { url: "https://openrouter.ai/api/v1/models", kind: "api", format: "json", target: "openrouter", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "api:anthropic": { url: "https://docs.anthropic.com/en/docs/about-claude/pricing", kind: "api", format: "html", target: "anthropic", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "api:openai": { url: "https://platform.openai.com/docs/pricing", kind: "api", format: "html", target: "openai", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "api:google": { url: "https://ai.google.dev/gemini-api/docs/pricing", kind: "api", format: "html", target: "gemini", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "api:zai": { url: "https://docs.z.ai/guides/overview/pricing", kind: "api", format: "html", target: "zai", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "api:moonshot": { url: "https://platform.moonshot.ai/docs/pricing", kind: "api", format: "html", target: "kimi", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "api:deepseek": { url: "https://api-docs.deepseek.com/quick_start/pricing", kind: "api", format: "html", target: "deepseek", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:anthropic": { url: "https://www.anthropic.com/pricing", kind: "subscriptions", format: "html", target: "claude", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:openai": { url: "https://openai.com/chatgpt/pricing", kind: "subscriptions", format: "html", target: "codex", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:cursor": { url: "https://cursor.com/pricing", kind: "subscriptions", format: "html", target: "cursor", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:zai": { url: "https://z.ai/subscribe", kind: "subscriptions", format: "html", target: "zcode", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:moonshot": { url: "https://www.kimi.com/membership", kind: "subscriptions", format: "html", target: "kimi", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:opencode": { url: "https://opencode.ai/zen", kind: "subscriptions", format: "html", target: "opencode", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
  "subscriptions:google": { url: "https://one.google.com/about/ai-plans", kind: "subscriptions", format: "html", target: "gemini", status: "ok", lastCheckedAt: null, lastError: null, discoveredAt: "" },
};

/* --------------------------------- чтение --------------------------------- */

const CACHE_TTL_MS = 60_000;
let cache: { at: number; data: CatalogData } | null = null;

export function invalidatePricingCatalogCache(): void {
  cache = null;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Каталог целиком; отсутствующие файлы дают пустые разделы (без создания на диске). */
export async function readCatalog(repoRoot: string): Promise<CatalogData> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const [subscriptions, models, sources] = await Promise.all([
    readJson<CatalogData["subscriptions"]>(subscriptionsFile(repoRoot)),
    readJson<CatalogData["models"]>(modelsFile(repoRoot)),
    readJson<CatalogData["sources"]>(sourcesFile(repoRoot)),
  ]);
  const entries = models?.models ?? {};
  const data: CatalogData = {
    subscriptions: {
      updatedAt: subscriptions?.updatedAt ?? "",
      vendors: subscriptions?.vendors ?? {},
      providers: subscriptions?.providers ?? {},
    },
    models: {
      updatedAt: models?.updatedAt ?? "",
      models: Object.fromEntries(
        Object.entries(entries).map(([id, entry]) => [id, { ...entry, average: computeAverage(entry.prices) }]),
      ),
    },
    sources: { recordedAt: sources?.recordedAt ?? "", sources: sources?.sources ?? {} },
  };
  cache = { at: Date.now(), data };
  return data;
}

export function catalogDTO(data: CatalogData): PricingCatalogDTO {
  return {
    subscriptions: data.subscriptions,
    models: data.models,
    sources: Object.entries(data.sources.sources).map(([id, source]) => ({ id, ...source })),
  };
}

/* --------------------------------- refresh --------------------------------- */

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_CONCURRENCY = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; harness-console/1.0; pricing-refresh)";

export interface RefreshResult {
  checked: number;
  ok: number;
  unavailable: { id: string; error: string }[];
  modelsUpdated: boolean;
  checkedAt: string;
}

/** Нормализация id модели внешнего каталога к id models.json: "anthropic/claude-sonnet-5.5" -> "claude-sonnet-5-5". */
function normalizeModelId(rawId: string): string {
  const withoutPrefix = rawId.includes("/") ? rawId.slice(rawId.lastIndexOf("/") + 1) : rawId;
  return withoutPrefix.trim().toLowerCase().replaceAll(".", "-");
}

interface OpenRouterModel {
  id?: string;
  pricing?: { prompt?: string; completion?: string };
}

/** JSON-источник: каталог моделей OpenRouter добавляет точки provider=openrouter в models.json. */
async function refreshJsonSource(
  repoRoot: string,
  data: CatalogData,
  source: SourceRecord,
  nowIso: string,
): Promise<{ error: string | null; changed: boolean }> {
  let payload: { data?: OpenRouterModel[] };
  try {
    const res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { error: `HTTP ${res.status}`, changed: false };
    payload = (await res.json()) as { data?: OpenRouterModel[] };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "запрос не выполнен", changed: false };
  }
  const remote = payload.data ?? [];
  if (remote.length === 0) return { error: "пустой ответ каталога моделей", changed: false };
  const updated: Record<string, ModelPriceEntry> = { ...data.models.models };
  let changed = false;
  for (const model of remote) {
    if (!model?.id || !model.pricing) continue;
    const input = Number(model.pricing.prompt);
    const output = Number(model.pricing.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    const modelId = normalizeModelId(model.id);
    const entry = updated[modelId];
    if (!entry) continue; // в каталоге только модели harness-рантаймов и провайдеров
    const point: ModelPricePoint = {
      provider: source.target,
      inputPerMtok: Math.round(input * 1e6 * 1000) / 1000,
      outputPerMtok: Math.round(output * 1e6 * 1000) / 1000,
      source: source.url,
      asOf: nowIso.slice(0, 10),
    };
    const existing = entry.prices.findIndex((p) => p.provider === point.provider);
    const prices = [...entry.prices];
    if (existing >= 0) {
      const prev = prices[existing];
      if (prev.inputPerMtok === point.inputPerMtok && prev.outputPerMtok === point.outputPerMtok && prev.cacheReadPerMtok === point.cacheReadPerMtok) continue;
      prices[existing] = point;
    } else {
      prices.push(point);
    }
    updated[modelId] = { ...entry, prices };
    changed = true;
  }
  if (changed) {
    await atomicWrite(modelsFile(repoRoot), `${JSON.stringify({ ...data.models, updatedAt: nowIso, models: updated }, null, 2)}\n`);
  }
  return { error: null, changed };
}

/** HTML-источник: проверка доступности; значения цен такими источниками не обновляются (правка в файлах каталога). */
async function checkHtmlSource(source: SourceRecord): Promise<string | null> {
  try {
    const res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    // Любой HTTP-ответ - источник доступен; 403/429 означают ограничение для автоматических запросов.
    if (res.status === 403 || res.status === 429) return `HTTP ${res.status} (доступ ограничен для автоматических запросов)`;
    if (!res.ok) return `HTTP ${res.status}`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "запрос не выполнен";
  }
}

async function loadSources(repoRoot: string): Promise<{ data: CatalogData; created: boolean }> {
  const data = await readCatalog(repoRoot);
  let created = false;
  if (Object.keys(data.sources.sources).length === 0) {
    const nowIso = new Date().toISOString();
    data.sources = {
      recordedAt: nowIso,
      sources: Object.fromEntries(Object.entries(DEFAULT_SOURCES).map(([id, s]) => [id, { ...s, discoveredAt: nowIso }])),
    };
    await atomicWrite(sourcesFile(repoRoot), `${JSON.stringify(data.sources, null, 2)}\n`);
    created = true;
  }
  return { data, created };
}

/**
 * Обновление из зафиксированных источников: json - парсинг и обновление
 * models.json, html - проверка доступности. Недоступный источник помечается
 * status "unavailable", значения каталога остаются прежними.
 */
export async function refreshCatalog(repoRoot: string): Promise<RefreshResult> {
  invalidatePricingCatalogCache();
  const { data, created } = await loadSources(repoRoot);
  const nowIso = new Date().toISOString();
  const sources = Object.entries(data.sources.sources);
  const results = new Map<string, { error: string | null; changed: boolean }>();
  let modelsChanged = false;
  for (let i = 0; i < sources.length; i += FETCH_CONCURRENCY) {
    const batch = sources.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async ([id, source]) => {
        if (source.format === "json") {
          const result = await refreshJsonSource(repoRoot, data, source, nowIso);
          results.set(id, result);
          if (result.changed) modelsChanged = true;
        } else {
          results.set(id, { error: await checkHtmlSource(source), changed: false });
        }
      }),
    );
  }
  const unavailable: { id: string; error: string }[] = [];
  const updatedSources: Record<string, SourceRecord> = { ...data.sources.sources };
  for (const [id, result] of results) {
    const source = updatedSources[id];
    if (!source) continue;
    updatedSources[id] = { ...source, status: result.error === null ? "ok" : "unavailable", lastCheckedAt: nowIso, lastError: result.error };
    if (result.error !== null) unavailable.push({ id, error: result.error });
  }
  await atomicWrite(sourcesFile(repoRoot), `${JSON.stringify({ ...data.sources, recordedAt: created ? nowIso : data.sources.recordedAt, sources: updatedSources }, null, 2)}\n`);
  invalidatePricingCatalogCache();
  const okCount = [...results.values()].filter((r) => r.error === null).length;
  return { checked: results.size, ok: okCount, unavailable, modelsUpdated: modelsChanged, checkedAt: nowIso };
}

/** Удобная точка входа для роутов: каталог текущего репозитория. */
export async function loadPricingCatalogDTO(): Promise<{ repoRoot: string; dto: PricingCatalogDTO }> {
  const repoRoot = findRepoRoot();
  return { repoRoot, dto: catalogDTO(await readCatalog(repoRoot)) };
}
