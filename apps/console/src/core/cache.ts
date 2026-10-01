import type { DashboardDataDTO } from "./types";

/**
 * Микро-кеш дашборда (dedupe + TTL): повторные открытия страниц и опросы
 * каждые 10 с не пересчитывают проб всех рантаймов заново.
 * Мутирующие роуты сбрасывают кеш через invalidateDashboardCache().
 */

const TTL_MS = 5_000;

interface Entry {
  data: DashboardDataDTO | null;
  at: number;
  inflight: Promise<DashboardDataDTO> | null;
}

const entries = new Map<string, Entry>();

export async function cachedDashboardData(
  key: string,
  compute: () => Promise<DashboardDataDTO>,
): Promise<DashboardDataDTO> {
  const now = Date.now();
  const entry = entries.get(key);
  if (entry && now - entry.at < TTL_MS && entry.data) {
    return entry.data;
  }
  if (entry?.inflight) {
    return entry.inflight;
  }
  const promise = compute()
    .then((data) => {
      entries.set(key, { data, at: Date.now(), inflight: null });
      return data;
    })
    .catch((err) => {
      const current = entries.get(key);
      if (current && current.inflight === promise) entries.delete(key);
      throw err;
    });
  entries.set(key, { data: entry?.data ?? null, at: entry?.at ?? 0, inflight: promise });
  return promise;
}

export function invalidateDashboardCache(): void {
  entries.clear();
}
