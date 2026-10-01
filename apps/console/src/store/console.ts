"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import "@/plugins/runtimes"; // регистрация UI-плагинов рантаймов (побочный эффект)
import type { WindowKey } from "@/lib/format";

/**
 * Клиентский стор консоли (zustand): общие параметры хранятся в одном месте,
 * UI-настройки (окно недавности, авто-refresh) кешируются в localStorage.
 * Порядок мутаций: сначала запись на сервер (файл state.json), потом set() стора.
 * Кеш вкладок (tabCache) делает переключение вкладок мгновенным: свежие данные
 * отдаются из памяти, протухшие - обновляются в фоне.
 */

export type TaskRuntimes = { promptExecution: string | null; skillCreation: string | null };

export interface RuntimeInfo {
  id: string;
  displayName: string;
  hasAdapter: boolean;
  hooksSupport?: string;
}

interface ConsoleStore {
  // серверные значения
  defaultRuntime: string | null;
  taskRuntimes: TaskRuntimes | null;
  useGlobalSkills: boolean | null;
  runtimes: RuntimeInfo[];
  // локальные (persist)
  windowKey: WindowKey;
  autoRefresh: boolean;
  /** Активный режим темы: какой слот токенов рендерится (тёмный или светлый). */
  theme: ThemeMode;
  // загрузка
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Кеш данных вкладок: key → {at, data}. */
  tabCache: Record<string, { at: number; data: unknown }>;
  fetchTabData: <T>(key: string, url: string, ttlMs?: number) => Promise<T | null>;
  invalidateTab: (prefix: string) => void;

  setDefaultRuntime: (id: string | null) => Promise<void>;
  saveTaskRuntimes: (next: TaskRuntimes) => Promise<void>;
  setUseGlobalSkills: (value: boolean) => Promise<void>;
  setSkillDefault: (itemId: string, enabled: boolean) => Promise<boolean | null>;
  setWindowKey: (key: WindowKey) => void;
  setAutoRefresh: (value: boolean) => void;
  setTheme: (value: ThemeMode) => void;
}

export type ThemeMode = "dark" | "light";

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, { cache: "no-store", ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function patchJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const useConsoleStore = create<ConsoleStore>()(
  persist(
    (set, get) => ({
      defaultRuntime: null,
      taskRuntimes: null,
      useGlobalSkills: null,
      runtimes: [],
      windowKey: "7d",
      autoRefresh: true,
      theme: "dark",
      hydrated: false,
      tabCache: {},

      hydrate: async () => {
        const [dashboard, settings, skills, runtimes] = await Promise.all([
          fetchJson<{ defaultRuntime?: string | null }>("/api/runtimes"),
          fetchJson<{ taskRuntimes?: TaskRuntimes; installed?: string[] }>("/api/settings"),
          fetchJson<{ useGlobal?: boolean }>("/api/skills?runtime=claude"),
          fetchJson<{ runtimes?: RuntimeInfo[] }>("/api/runtimes/list"),
        ]);
        set({
          defaultRuntime: dashboard?.defaultRuntime ?? null,
          taskRuntimes: settings?.taskRuntimes ?? { promptExecution: null, skillCreation: null },
          runtimes: runtimes?.runtimes ?? [],
          useGlobalSkills: skills?.useGlobal ?? null,
          hydrated: true,
        });
      },

      fetchTabData: async <T,>(key: string, url: string, ttlMs = 10_000): Promise<T | null> => {
        const cached = get().tabCache[key];
        if (cached && Date.now() - cached.at < ttlMs) {
          return cached.data as T;
        }
        const data = await fetchJson<T>(url);
        if (data !== null) {
          set((s) => ({ tabCache: { ...s.tabCache, [key]: { at: Date.now(), data } } }));
          return data;
        }
        // сеть недоступна или маршрут не отвечает - отдаём устаревший кеш, если есть
        return cached ? (cached.data as T) : null;
      },

      invalidateTab: (prefix) => {
        set((s) => {
          const next: typeof s.tabCache = {};
          for (const [key, value] of Object.entries(s.tabCache)) {
            if (!key.startsWith(prefix)) next[key] = value;
          }
          return { tabCache: next };
        });
      },

      setDefaultRuntime: async (id) => {
        // файл на сервере обновляется первым; стор - только после подтверждения
        const result = await patchJson<{ ok?: boolean }>("/api/runtimes", { defaultRuntime: id });
        if (result) set({ defaultRuntime: id });
      },

      saveTaskRuntimes: async (next) => {
        try {
          const res = await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskRuntimes: next }),
          });
          if (res.ok) set({ taskRuntimes: next });
        } catch {
          /* файл не записался - стор не изменяем */
        }
      },

      setUseGlobalSkills: async (value) => {
        const result = await patchJson<{ ok?: boolean }>("/api/skills", {
          level: "useGlobal",
          enabled: value,
        });
        if (result) set({ useGlobalSkills: value });
      },

      setSkillDefault: async (itemId, enabled) => {
        const result = await patchJson<{ enabled?: boolean }>("/api/skills", {
          level: "default",
          itemId,
          enabled,
        });
        if (result) return result.enabled ?? enabled;
        return null;
      },

      setWindowKey: (key) => set({ windowKey: key }),
      setAutoRefresh: (value) => set({ autoRefresh: value }),
      setTheme: (value) => {
        document.documentElement.dataset.theme = value;
        set({ theme: value });
      },
    }),
    {
      name: "agentic-console-ui",
      partialize: (state) => ({ windowKey: state.windowKey, autoRefresh: state.autoRefresh, theme: state.theme }),
    },
  ),
);

/** Эффективный рантайм задачи на клиенте: назначенный или рантайм по умолчанию. */
export function effectiveTaskRuntime(
  state: Pick<ConsoleStore, "taskRuntimes" | "defaultRuntime">,
  task: keyof TaskRuntimes,
): string | null {
  return state.taskRuntimes?.[task] ?? state.defaultRuntime ?? null;
}

/** Селектор для useConsoleStore(effectiveTaskRuntimeSelector("promptExecution")). */
export function effectiveTaskRuntimeSelector(task: keyof TaskRuntimes) {
  return (state: ConsoleStore): string | null => effectiveTaskRuntime(state, task);
}
