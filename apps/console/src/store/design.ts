"use client";

import { create } from "zustand";
import { applyMultipliers, IDENTITY, isIdentity, type Multipliers } from "@/lib/color";
import { buildDesignFile } from "@/lib/design-format";
import {
  matchPreset,
  presetById,
  themePresetFile,
  type ThemeMode,
  type ThemePreset,
  type ThemeTokens,
} from "@/lib/themes";

/**
 * Стор тем (zustand, без persist - сознательно): `saved` - сохранённое состояние
 * из DESIGN.md/DESIGN.light.md, `draft` - несохранённый черновик (базовые токены +
 * множители слайдеров). Финальные значения = base × multipliers; обновление
 * страницы сбрасывает черновик, "Сохранить" запекает значения в файлы.
 *
 * Файлы пресетов лежат в themes/ и подгружаются лениво (loadPresetFile) - при
 * выборе пресета, для предпросмотра "все настройки и описание". Отрендеренный
 * файл (renderedFile) при твиках пересобирается на клиенте из draft-токенов
 * с именем "<База> (Custom)" - сам DESIGN.md меняется только по "Сохранить".
 */

export interface SlotDraft {
  base: ThemeTokens;
  mult: Multipliers;
}

export interface ThemeIndexEntry {
  file: string;
  name: string;
  mode: ThemeMode;
}

interface DesignStore {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  saved: Record<ThemeMode, ThemeTokens>;
  content: Record<ThemeMode, string>;
  names: Record<ThemeMode, string>;
  draft: Record<ThemeMode, SlotDraft>;
  /** Индекс папки themes/ (метаданные пресет-файлов). */
  themeIndex: ThemeIndexEntry[];
  /** Лениво загруженные файлы пресетов: `${mode}-${id}.md` → содержимое. */
  presetFiles: Record<string, string>;
  /** Ворнинги последнего сохранения (lint). */
  saveWarnings: string[];
  saving: boolean;

  load: () => Promise<void>;
  selectPreset: (mode: ThemeMode, presetId: string) => void;
  loadPresetFile: (presetId: string) => Promise<void>;
  setMultiplier: (mode: ThemeMode, key: keyof Multipliers, value: number) => void;
  resetSlider: (mode: ThemeMode, key: keyof Multipliers) => void;
  reset: () => void;
  save: () => Promise<boolean>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function identityDraft(tokens: ThemeTokens): SlotDraft {
  return { base: structuredClone(tokens), mult: { ...IDENTITY } };
}

/** Финальные токены слота с учётом множителей. */
export function finalTokens(draft: SlotDraft): ThemeTokens {
  return applyMultipliers(draft.base, draft.mult);
}

/** Пресет, соответствующий финальным токенам; иначе null → кастом. */
export function activePreset(mode: ThemeMode, draft: SlotDraft): ThemePreset | null {
  return matchPreset(mode, finalTokens(draft));
}

/** Пресет-основа черновика (от чего стартовал твит). */
export function basePreset(mode: ThemeMode, draft: SlotDraft): ThemePreset | null {
  return matchPreset(mode, draft.base);
}

/** Есть ли несохранённые изменения в слоте. */
export function isDirty(mode: ThemeMode, draft: SlotDraft, saved: ThemeTokens): boolean {
  if (!isIdentity(draft.mult)) return true;
  if (JSON.stringify(draft.base) !== JSON.stringify(saved)) return true;
  return matchPreset(mode, draft.base) === null;
}

/** Имя слота: совпавший пресет, иначе "<База> (Custom)" (без наращивания повторами). */
export function slotName(mode: ThemeMode, draft: SlotDraft, fallbackName: string): string {
  const final = activePreset(mode, draft);
  if (final) return final.name;
  const base = basePreset(mode, draft);
  if (base) return `${base.name} (Custom)`;
  // основа уже кастомная (сохранённая раньше) - имя не дублируем
  return fallbackName;
}

interface RenderedFile {
  name: string;
  content: string;
}

/**
 * Отрендеренный файл слота: при твиках пересобирается на клиенте из draft-токенов
 * (тело - из файла пресета-основы, лениво загруженного, иначе из дискового
 * DESIGN-файла); без твиков - фактическое содержимое файла с диска.
 */
export function renderedFile(
  mode: ThemeMode,
  state: Pick<DesignStore, "saved" | "content" | "names" | "draft" | "presetFiles">,
): RenderedFile {
  const draft = state.draft[mode];
  const dirty = isDirty(mode, draft, state.saved[mode]);
  const base = basePreset(mode, draft);
  const baseDoc = (base && state.presetFiles[themePresetFile(base)]) || state.content[mode];
  const name = slotName(mode, draft, state.names[mode]);
  if (dirty) {
    return { name, content: buildDesignFile(baseDoc, finalTokens(draft), name) };
  }
  return { name, content: state.content[mode] };
}

interface DesignResponse {
  dark: { tokens: ThemeTokens; name: string; content: string; exists: boolean };
  light: { tokens: ThemeTokens; name: string; content: string; exists: boolean };
  themeIndex: ThemeIndexEntry[];
}

export const useDesignStore = create<DesignStore>()((set, get) => ({
  status: "idle",
  error: null,
  saved: { dark: presetById("graphite")!.tokens, light: presetById("graphite-light")!.tokens },
  content: { dark: "", light: "" },
  names: { dark: "Graphite", light: "Graphite Light" },
  draft: {
    dark: identityDraft(presetById("graphite")!.tokens),
    light: identityDraft(presetById("graphite-light")!.tokens),
  },
  themeIndex: [],
  presetFiles: {},
  saveWarnings: [],
  saving: false,

  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading", error: null });
    const data = await fetchJson<DesignResponse>("/api/design");
    if (!data) {
      set({ status: "error", error: "не удалось загрузить /api/design" });
      return;
    }
    const saved: Record<ThemeMode, ThemeTokens> = { dark: data.dark.tokens, light: data.light.tokens };
    set({
      status: "ready",
      saved,
      content: { dark: data.dark.content, light: data.light.content },
      names: { dark: data.dark.name, light: data.light.name },
      draft: { dark: identityDraft(saved.dark), light: identityDraft(saved.light) },
      themeIndex: data.themeIndex ?? [],
    });
  },

  selectPreset: (mode, presetId) => {
    const preset = presetById(presetId);
    if (!preset || preset.mode !== mode) return;
    set((s) => ({ draft: { ...s.draft, [mode]: identityDraft(preset.tokens) } }));
  },

  loadPresetFile: async (presetId) => {
    const preset = presetById(presetId);
    if (!preset) return;
    const file = themePresetFile(preset);
    if (get().presetFiles[file]) return;
    const data = await fetchJson<{ content: string }>(`/api/design/theme?file=${encodeURIComponent(file)}`);
    if (!data) return;
    set((s) => ({ presetFiles: { ...s.presetFiles, [file]: data.content } }));
  },

  setMultiplier: (mode, key, value) => {
    set((s) => ({
      draft: { ...s.draft, [mode]: { ...s.draft[mode], mult: { ...s.draft[mode].mult, [key]: value } } },
    }));
  },

  resetSlider: (mode, key) => {
    set((s) => ({
      draft: { ...s.draft, [mode]: { ...s.draft[mode], mult: { ...s.draft[mode].mult, [key]: IDENTITY[key] } } },
    }));
  },

  reset: () => {
    set((s) => ({
      draft: { dark: identityDraft(s.saved.dark), light: identityDraft(s.saved.light) },
      saveWarnings: [],
    }));
  },

  save: async () => {
    const { draft, names } = get();
    set({ saving: true });
    const body = {
      dark: { ...finalTokens(draft.dark), name: slotName("dark", draft.dark, names.dark) },
      light: { ...finalTokens(draft.light), name: slotName("light", draft.light, names.light) },
    };
    // PUT идемпотентен: в dev bake globals.css может оборвать ещё не отправленный
    // ответ (Turbopack пересобирает пайплайн) - поэтому один автоматический повтор.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch("/api/design", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; warnings?: string[]; saved?: Record<string, { name: string }> }
          | null;
        if (!res.ok || !json?.ok) {
          set({
            saving: false,
            error: json?.error ?? `сервер вернул ${res.status} - темы не сохранены`,
            saveWarnings: [],
          });
          return false;
        }
        const saved: Record<ThemeMode, ThemeTokens> = {
          dark: structuredClone(body.dark),
          light: structuredClone(body.light),
        };
        set((s) => ({
          saving: false,
          error: null,
          saved,
          draft: { dark: identityDraft(saved.dark), light: identityDraft(saved.light) },
          saveWarnings: json.warnings ?? [],
          names: {
            dark: json.saved?.dark?.name ?? s.names.dark,
            light: json.saved?.light?.name ?? s.names.light,
          },
        }));
        return true;
      } catch (cause) {
        if (attempt === 2) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          set({ saving: false, error: `не удалось сохранить темы (${reason})`, saveWarnings: [] });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    return false;
  },
}));
