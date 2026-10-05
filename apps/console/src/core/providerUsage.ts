import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROVIDER_PRESETS } from "./providers";

/**
 * Хранилище статистики использования токенов - файл
 * .agents/console/provider-usage.json. Четыре источника записей:
 * - "provider-run" - прямые вызовы провайдеров консолью (запуск промптов,
 *   задачи provider:<id>): usage приходит в ответе API;
 * - "agent-chat" - диалог вкладки "Агент" (POST /api/agent/chat, провайдер);
 * - "runtime-session" - сессии рантаймов из транскриптов
 *   (core/usage/runtimeTranscripts.ts);
 * - "tool-ledger" - собственные счётчики инструментов (graphify, headroom;
 *   core/usage/toolLedgers.ts).
 * Хвост records ограничен, инкрементальные totals/days - полные.
 */

export type UsageSource = "provider-run" | "agent-chat" | "runtime-session" | "tool-ledger";

export interface UsageRecord {
  at: string;
  source: UsageSource;
  /** id провайдера пресета, "runtime:<vendor>" или имя инструмента. */
  provider: string;
  model?: string;
  runtime?: string;
  /** Вид вызова: "prompt-run" / "skill-create" / id сессии / бэкенд инструмента. */
  kind?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Дополнительные числа: precached, cache_read и т.п. */
  details?: Record<string, number>;
}

export interface ProviderUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastAt: string | null;
  models: Record<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number }>;
}

interface ProviderUsageFile {
  version: 1;
  records: UsageRecord[];
  totals: Record<string, ProviderUsageTotals>;
  /** День (YYYY-MM-DD) -> провайдер -> totalTokens. Хранятся последние 90 дней. */
  days: Record<string, Record<string, number>>;
  /** Байтовый офсет обработанной части файла транскрипта/ledger'а (инкремент). */
  cursors: Record<string, number>;
  /** Последние кумулятивные счётчики (codex total_token_usage, graphify totals). */
  cumulative: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>;
  collectedAt: string | null;
}

const MAX_RECORDS = 2000;
const MAX_DAYS = 90;

export function providerUsageFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "provider-usage.json");
}

export async function readProviderUsage(repoRoot: string): Promise<ProviderUsageFile> {
  try {
    const raw = JSON.parse(await readFile(providerUsageFilePath(repoRoot), "utf8")) as Partial<ProviderUsageFile>;
    return {
      version: 1,
      records: Array.isArray(raw.records) ? raw.records : [],
      totals: raw.totals ?? {},
      days: raw.days ?? {},
      cursors: raw.cursors ?? {},
      cumulative: raw.cumulative ?? {},
      collectedAt: raw.collectedAt ?? null,
    };
  } catch {
    return { version: 1, records: [], totals: {}, days: {}, cursors: {}, cumulative: {}, collectedAt: null };
  }
}

async function writeProviderUsage(repoRoot: string, data: ProviderUsageFile): Promise<void> {
  const file = providerUsageFilePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function dayKey(at: string): string {
  return at.slice(0, 10);
}

function pruneDays(days: ProviderUsageFile["days"]): ProviderUsageFile["days"] {
  const keys = Object.keys(days).sort();
  if (keys.length <= MAX_DAYS) return days;
  const keep = new Set(keys.slice(-MAX_DAYS));
  return Object.fromEntries(Object.entries(days).filter(([day]) => keep.has(day)));
}

function applyRecord(data: ProviderUsageFile, record: UsageRecord): void {
  data.records.push(record);
  const bucket = (data.totals[record.provider] ??= {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastAt: null,
    models: {},
  });
  bucket.calls += 1;
  bucket.inputTokens += record.inputTokens;
  bucket.outputTokens += record.outputTokens;
  bucket.totalTokens += record.totalTokens;
  if (!bucket.lastAt || record.at > bucket.lastAt) bucket.lastAt = record.at;
  const modelKey = record.model ?? "";
  if (modelKey) {
    const model = (bucket.models[modelKey] ??= { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    model.calls += 1;
    model.inputTokens += record.inputTokens;
    model.outputTokens += record.outputTokens;
    model.totalTokens += record.totalTokens;
  }
  const day = dayKey(record.at);
  const dayBucket = (data.days[day] ??= {});
  dayBucket[record.provider] = (dayBucket[record.provider] ?? 0) + record.totalTokens;
}

function finalize(data: ProviderUsageFile): void {
  if (data.records.length > MAX_RECORDS) data.records = data.records.slice(-MAX_RECORDS);
  data.days = pruneDays(data.days);
}

/** Добавить записи: хвост records, инкремент totals и days. */
export async function appendUsageRecords(repoRoot: string, input: UsageRecord[]): Promise<void> {
  if (input.length === 0) return;
  const data = await readProviderUsage(repoRoot);
  for (const record of input) applyRecord(data, record);
  finalize(data);
  await writeProviderUsage(repoRoot, data);
}

export interface UsageCollectionUpdate {
  records: UsageRecord[];
  /** Новые позиции обработки файлов транскриптов/ledger'ов (слияние с существующими). */
  cursors?: Record<string, number>;
  /** Последние кумулятивные счётчики (codex, graphify). */
  cumulative?: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>;
}

/**
 * Применить итоги сбора внешних источников одной записью файла: записи
 * статистики + позиции курсоров + кумулятивные счётчики.
 */
export async function applyUsageCollection(repoRoot: string, update: UsageCollectionUpdate): Promise<void> {
  const data = await readProviderUsage(repoRoot);
  for (const record of update.records) applyRecord(data, record);
  Object.assign(data.cursors, update.cursors ?? {});
  Object.assign(data.cumulative, update.cumulative ?? {});
  finalize(data);
  await writeProviderUsage(repoRoot, data);
}

/** Пометить момент последнего сбора внешних источников (TTL в вызывающем коде). */
export async function markUsageCollected(repoRoot: string): Promise<void> {
  const data = await readProviderUsage(repoRoot);
  data.collectedAt = new Date().toISOString();
  await writeProviderUsage(repoRoot, data);
}

export interface ProviderUsageSummary {
  records: UsageRecord[];
  totals: Record<string, ProviderUsageTotals>;
  days: Record<string, Record<string, number>>;
  collectedAt: string | null;
}

/** Выгрузка для API и внешних инструментов: хвост записей и агрегаты. */
export async function providerUsageSummary(repoRoot: string): Promise<ProviderUsageSummary> {
  const data = await readProviderUsage(repoRoot);
  return { records: data.records.slice(-200), totals: data.totals, days: data.days, collectedAt: data.collectedAt };
}

/* --------------------------- атрибуция модель -> провайдер --------------------------- */

const vendorConfigCache = new Map<string, { at: number; models: Map<string, string> }>();

/**
 * Индекс "имя модели -> vendor" из конфигов рантаймов (.agents/runtime/<vendor>/config.json,
 * поле models.<tier>.model). Кешируется на 60 с.
 */
export async function vendorModelIndex(repoRoot: string): Promise<Map<string, string>> {
  const dir = path.join(repoRoot, ".agents", "runtime");
  const cached = vendorConfigCache.get(repoRoot);
  if (cached && Date.now() - cached.at < 60_000) return cached.models;
  const models = new Map<string, string>();
  const vendors = await readdir(dir).catch(() => [] as string[]);
  for (const vendor of vendors) {
    if (vendor.endsWith(".json") || vendor.startsWith(".")) continue;
    const configPath = path.join(dir, vendor, "config.json");
    try {
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        models?: Record<string, { model?: string }>;
      };
      for (const tier of Object.values(config.models ?? {})) {
        if (tier?.model) models.set(tier.model, vendor);
      }
    } catch {
      /* отсутствующий или повреждённый конфиг рантайма пропускается */
    }
  }
  vendorConfigCache.set(repoRoot, { at: Date.now(), models });
  return models;
}

/**
 * Атрибуция имени модели провайдеру: точное совпадение с моделями пресетов
 * (provider id), затем с моделями рантаймов ("runtime:<vendor>"); без
 * совпадения - null (вызывающий код использует имя рантайма/инструмента).
 */
export function modelToProvider(model: string, vendorModels: Map<string, string>): string | null {
  if (!model) return null;
  for (const preset of PROVIDER_PRESETS) {
    if (Object.values(preset.models).includes(model)) return preset.id;
  }
  const vendor = vendorModels.get(model);
  return vendor ? `runtime:${vendor}` : null;
}
