import type { ActivityScope } from "@/core/types";

/** Ключи окна недавности (граница "недавно активен" / "неактивен"). */
export type WindowKey = "1h" | "24h" | "7d" | "all";

export const WINDOW_MS: Record<WindowKey, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  all: Number.MAX_SAFE_INTEGER,
};

export const WINDOW_OPTIONS: { key: WindowKey; label: string }[] = [
  { key: "1h", label: "1 час" },
  { key: "24h", label: "24 часа" },
  { key: "7d", label: "7 дней" },
  { key: "all", label: "всё" },
];

export const DEFAULT_WINDOW: WindowKey = "7d";

export function parseWindowParam(value: string | null): WindowKey {
  return value !== null && value in WINDOW_MS ? (value as WindowKey) : DEFAULT_WINDOW;
}

export function relativeTime(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  if (ms < 45_000) return "только что";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export function scopeLabel(scope: ActivityScope): string {
  return scope === "repo" ? "этот репозиторий" : "машина";
}
