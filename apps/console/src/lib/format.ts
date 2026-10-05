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

/** Число токенов в компактной форме: 1234 -> "1,2K", 5600000 -> "5,6M". */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(".", ",")}K`;
  return String(value);
}

/** Время сообщения: "14:32". */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Ключ календарного дня по локальному времени: "2026-10-02". */
export function dayKey(iso: string | number | Date): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Подпись дня для разделителя диалога: "сегодня", "вчера" или дата. */
export function dayLabel(iso: string): string {
  const key = dayKey(iso);
  const now = new Date();
  if (key === dayKey(now)) return "сегодня";
  if (key === dayKey(now.getTime() - 86_400_000)) return "вчера";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Длительность в компактной форме: 65000 -> "1 мин 5 с", 4200 -> "4 с". */
export function durationLabel(ms: number): string {
  if (ms < 1_000) return `${ms} мс`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин ${seconds % 60} с`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}
