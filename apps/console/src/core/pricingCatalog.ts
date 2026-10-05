/**
 * Каталог цен - клиентская часть: типы, константы периодов и чистые функции
 * расчёта. Файлы .agents/pricing/ читает и обновляет серверная половина
 * (core/pricingCatalogServer.ts); UI импортирует только этот модуль.
 *
 * Правило эффективной цены модели (effectiveModelPrice): официальная цена ->
 * средняя по провайдерам -> "none" (токены без стоимости).
 */

export type PlanPeriod = "month" | "quarter" | "halfyear" | "year";

export const PLAN_PERIOD_MONTHS: Record<PlanPeriod, number> = { month: 1, quarter: 3, halfyear: 6, year: 12 };

export const PLAN_PERIOD_LABEL: Record<PlanPeriod, string> = {
  month: "мес",
  quarter: "квартал",
  halfyear: "полгода",
  year: "год",
};

export interface SubscriptionPlan {
  id: string;
  name: string;
  period: PlanPeriod;
  price: number;
  currency: string;
}

export interface VendorBilling {
  label: string;
  site?: string;
  payg: { available: boolean; note?: string };
  plans: SubscriptionPlan[];
}

export interface ModelPricePoint {
  provider: string;
  official?: boolean;
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number;
  source?: string;
  asOf?: string;
  note?: string;
}

export interface ModelAverage {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number;
}

export interface ModelPriceEntry {
  label?: string;
  /** Отображаемые имена модели в конфигах рантаймов: "Claude Opus 5" -> claude-opus-5-5. */
  aliases?: string[];
  prices: ModelPricePoint[];
  average: ModelAverage | null;
}

export interface SourceRecord {
  url: string;
  kind: "api" | "subscriptions";
  format: "html" | "json";
  target: string;
  status: "ok" | "unavailable";
  lastCheckedAt: string | null;
  lastError: string | null;
  discoveredAt: string;
}

export interface CatalogData {
  subscriptions: { updatedAt: string; vendors: Record<string, VendorBilling>; providers: Record<string, VendorBilling> };
  models: { updatedAt: string; models: Record<string, ModelPriceEntry> };
  sources: { recordedAt: string; sources: Record<string, SourceRecord> };
}

export interface PricingCatalogDTO {
  subscriptions: CatalogData["subscriptions"];
  models: CatalogData["models"];
  sources: (SourceRecord & { id: string })[];
}

export interface EffectivePrice {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number;
  origin: "official" | "average" | "none";
}

export function computeAverage(prices: ModelPricePoint[]): ModelAverage | null {
  if (prices.length === 0) return null;
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
  const inputs = prices.map((p) => p.inputPerMtok);
  const outputs = prices.map((p) => p.outputPerMtok);
  const cacheReads = prices.filter((p) => typeof p.cacheReadPerMtok === "number").map((p) => p.cacheReadPerMtok as number);
  const average: ModelAverage = { inputPerMtok: mean(inputs), outputPerMtok: mean(outputs) };
  if (cacheReads.length > 0) average.cacheReadPerMtok = mean(cacheReads);
  return average;
}

/**
 * Запись модели каталога: точный id в нижнем регистре или алиас (конфиги
 * рантаймов хранят отображаемые имена вроде "Claude Opus 5"); пробелы в
 * обеих сторонах сравнения приводятся к дефису.
 */
export function modelEntry(models: Record<string, ModelPriceEntry>, modelId: string): ModelPriceEntry | undefined {
  const key = modelId.trim().toLowerCase().replaceAll(/\s+/g, "-");
  if (!key) return undefined;
  const direct = models[key];
  if (direct) return direct;
  for (const entry of Object.values(models)) {
    if ((entry.aliases ?? []).some((alias) => alias.trim().toLowerCase().replaceAll(/\s+/g, "-") === key)) return entry;
  }
  return undefined;
}

/**
 * Эффективная цена модели для расчётов и сравнения: цена официального
 * провайдера (official: true), иначе средняя по всем провайдерам каталога;
 * модели нет в каталоге - "none".
 */
export function effectiveModelPrice(data: CatalogData, modelId: string): EffectivePrice {
  const entry = modelEntry(data.models.models, modelId);
  if (!entry || entry.prices.length === 0) return { inputPerMtok: 0, outputPerMtok: 0, origin: "none" };
  const official = entry.prices.find((p) => p.official);
  if (official) {
    return {
      inputPerMtok: official.inputPerMtok,
      outputPerMtok: official.outputPerMtok,
      cacheReadPerMtok: official.cacheReadPerMtok,
      origin: "official",
    };
  }
  if (entry.average) {
    return { ...entry.average, origin: "average" };
  }
  return { inputPerMtok: 0, outputPerMtok: 0, origin: "none" };
}
