import type { ActivitySignal, ActivityStatus } from "./types";

/** Свежесть, ниже которой рантайм считается "активен сейчас". */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
/** Граница "был активен некоторое время назад" по умолчанию (7 дней). */
export const DEFAULT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function latestSignal(signals: ActivitySignal[]): ActivitySignal | null {
  return signals.reduce<ActivitySignal | null>(
    (latest, s) => (latest === null || s.at > latest.at ? s : latest),
    null,
  );
}

/**
 * Чистая классификация: active-now → недавно → неактивен.
 * Классифицирует по свежайшему сигналу; масштаб (repo/machine) виден в UI.
 */
export function classifyActivity(
  signals: ActivitySignal[],
  now: Date,
  recentWindowMs: number = DEFAULT_RECENT_WINDOW_MS,
): { status: ActivityStatus; latest: ActivitySignal | null } {
  const latest = latestSignal(signals);
  if (latest === null) return { status: "inactive", latest: null };
  const age = now.getTime() - latest.at.getTime();
  if (age <= ACTIVE_WINDOW_MS) return { status: "active-now", latest };
  if (age <= recentWindowMs) return { status: "recently-active", latest };
  return { status: "inactive", latest };
}

export const STATUS_ORDER: Record<ActivityStatus, number> = {
  "active-now": 0,
  "recently-active": 1,
  inactive: 2,
  disabled: 3,
  unknown: 4,
};
