"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { MarkdownView, splitFrontMatter } from "@/uikit/components/memory/MarkdownView";
import { isIdentity, type Multipliers } from "@/lib/color";
import { presetsFor, themePresetFile, type ColorRole, type ThemeMode, type ThemeTokens } from "@/lib/themes";
import { useConsoleStore } from "@/store/console";
import {
  activePreset,
  finalTokens,
  isDirty,
  renderedFile,
  slotName,
  useDesignStore,
  type SlotDraft,
} from "@/store/design";
import { Button, IconButton, Loading, Notice, Panel, Tabs } from "@/uikit";

/**
 * Панель "Внешний вид" (Настройки): выбор из 5 тёмных и 5 светлых пресетов,
 * слайдеры-твики активной темы (в духе навыка tweak), Reset/Сохранить
 * (запекание в DESIGN.md / DESIGN.light.md + globals.css) и предпросмотр
 * обоих файлов. Работа с дизайном проектов - раздел "Дизайн" (/design).
 */

const SLIDERS: { key: keyof Multipliers; label: string; min: number; max: number; step: number; percent: boolean }[] = [
  { key: "saturation", label: "Насыщенность", min: 0, max: 2, step: 0.01, percent: true },
  { key: "surfaceLight", label: "Светлота поверхностей", min: 0.8, max: 1.3, step: 0.01, percent: true },
  { key: "textContrast", label: "Контраст текста", min: 0.7, max: 1.3, step: 0.01, percent: true },
  { key: "accentLight", label: "Яркость акцентов", min: 0.8, max: 1.3, step: 0.01, percent: true },
  { key: "roundness", label: "Скруглённость", min: 0, max: 2, step: 0.05, percent: true },
];

const MODE_LABEL: Record<ThemeMode, string> = { dark: "тёмная", light: "светлая" };

export function DesignPanel() {
  const status = useDesignStore((s) => s.status);
  const error = useDesignStore((s) => s.error);
  const load = useDesignStore((s) => s.load);
  const saved = useDesignStore((s) => s.saved);
  const names = useDesignStore((s) => s.names);
  const draft = useDesignStore((s) => s.draft);
  const saveWarnings = useDesignStore((s) => s.saveWarnings);
  const saving = useDesignStore((s) => s.saving);
  const setMultiplier = useDesignStore((s) => s.setMultiplier);
  const resetSlider = useDesignStore((s) => s.resetSlider);
  const reset = useDesignStore((s) => s.reset);
  const save = useDesignStore((s) => s.save);

  const theme = useConsoleStore((s) => s.theme);
  const setTheme = useConsoleStore((s) => s.setTheme);
  const themeIndex = useDesignStore((s) => s.themeIndex);
  const presetFiles = useDesignStore((s) => s.presetFiles);
  const content = useDesignStore((s) => s.content);
  const draftAll = useDesignStore((s) => s.draft);
  const savedAll = useDesignStore((s) => s.saved);
  const namesAll = useDesignStore((s) => s.names);
  const selectPreset = useDesignStore((s) => s.selectPreset);
  const loadPresetFile = useDesignStore((s) => s.loadPresetFile);

  /** Выбор пресета + ленивая подгрузка его файла из themes/ для предпросмотра. */
  const pickPreset = (mode: ThemeMode, presetId: string) => {
    selectPreset(mode, presetId);
    void loadPresetFile(presetId);
  };

  // Отрендеренный файл активной темы: следит за ☀/☾ и пересобирается при твиках.
  const rendered = useMemo(
    () => renderedFile(theme, { saved: savedAll, content, names: namesAll, draft: draftAll, presetFiles }),
    [theme, draftAll, savedAll, namesAll, content, presetFiles],
  );

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  if (status === "idle" || status === "loading") return <Loading>загружаем темы…</Loading>;
  if (status === "error") return <Notice tone="error">{error}</Notice>;

  const dirtyDark = isDirty("dark", draft.dark, saved.dark);
  const dirtyLight = isDirty("light", draft.light, saved.light);
  const dirty = dirtyDark || dirtyLight;
  const current = draft[theme];
  const currentPreset = activePreset(theme, current);

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Изменения применяются ко всему интерфейсу сразу и сбрасываются при обновлении страницы. Кнопка
        "Сохранить" запекает значения в DESIGN.md / DESIGN.light.md (и в стилевой файл) - тогда они
        переживают перезагрузку.
      </Notice>

      <ThemeGroup
        title="Тёмные темы"
        mode="dark"
        draft={draft.dark}
        saved={saved.dark}
        onSelect={(id) => pickPreset("dark", id)}
      />
      <ThemeGroup
        title="Светлые темы"
        mode="light"
        draft={draft.light}
        saved={saved.light}
        onSelect={(id) => pickPreset("light", id)}
      />

      <Panel title={`Твики активной темы (${MODE_LABEL[theme]} · ${slotName(theme, current, namesAll[theme])})`}>
        <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
          Множители применяются к базовым значениям слота. Смена темы в шапке (☀/☾) переключает,
          какую тему ты сейчас крутишь.
        </p>
        <div className="space-y-3">
          {SLIDERS.map((slider) => {
            const value = current.mult[slider.key];
            const touched = value !== 1;
            return (
              <div key={slider.key} className="flex items-center gap-3">
                <span className="w-44 shrink-0 text-xs text-fg-muted">{slider.label}</span>
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={value}
                  onChange={(e) => setMultiplier(theme, slider.key, Number(e.target.value))}
                  className="h-1 w-full max-w-xs accent-accent"
                  aria-label={slider.label}
                />
                <span className={`w-14 shrink-0 text-right font-mono text-[11px] ${touched ? "text-accent" : "text-fg-faint"}`}>
                  {Math.round(value * 100)}%
                </span>
                <IconButton
                  icon={RotateCcw}
                  label={`сбросить ${slider.label}`}
                  variant="ghostDim"
                  size="xs"
                  onClick={() => resetSlider(theme, slider.key)}
                  disabled={!touched}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
            <Save size={14} />
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>
            <RotateCcw size={14} />
            Сбросить
          </Button>
          {dirty ? (
            <span className="text-[11px] text-warning">
              есть несохранённые изменения ({dirtyDark ? "тёмная" : ""}{dirtyDark && dirtyLight ? " + " : ""}
              {dirtyLight ? "светлая" : ""})
            </span>
          ) : (
            <span className="text-[11px] text-fg-faint">всё сохранено</span>
          )}
        </div>
        {error ? (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        ) : null}
        {saveWarnings.length > 0 ? (
          <Notice tone="info" className="mt-3">
            <span className="font-semibold">Предупреждения lint:</span>
            <ul className="mt-1 list-disc pl-4">
              {saveWarnings.slice(0, 6).map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </Panel>

      <Panel title="Файлы тем (@google/design.md)">
        <p className="mb-2 text-[11px] leading-relaxed text-fg-faint">
          Рендерится файл активной темы (переключается тумблером ☀/☾ или табом ниже). Пресеты лежат в
          папке <span className="font-mono">themes/</span> корня репозитория
          {themeIndex.length > 0 ? ` (${themeIndex.length} файлов)` : ""} и подгружаются лениво - при выборе
          карточки. Несохранённые твики показываются в предпросмотре сразу, но файл переписывается
          только кнопкой "Сохранить" - тогда кастом получает имя "&lt;База&gt; (Custom)".
        </p>
        <Tabs
          tabs={[
            { key: "dark", label: `DESIGN.md · ${slotName("dark", draftAll.dark, namesAll.dark)}` },
            { key: "light", label: `DESIGN.light.md · ${slotName("light", draftAll.light, namesAll.light)}` },
          ]}
          active={theme}
          onChange={setTheme}
          size="sm"
          className="mb-3"
        />
        {rendered.content ? (
          <DesignFileView content={rendered.content} name={rendered.name} />
        ) : (
          <Notice tone="error">Файл пуст или отсутствует в корне репозитория.</Notice>
        )}
      </Panel>
    </div>
  );
}

/**
 * Предпросмотр DESIGN-файла: YAML front matter - моноширинным блоком с
 * сохранением переносов (CommonMark схлопнул бы его в одну строку),
 * markdown-тело - через MarkdownView. Содержимое может быть пересобрано
 * на клиенте из draft-токенов (предпросмотр изменений до записи на диск).
 */
function DesignFileView({ content, name }: { content: string; name?: string }) {
  const { body, frontMatter } = splitFrontMatter(content);
  if (!frontMatter) return <MarkdownView content={content} />;
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-fg-faint">
        Токены (YAML front matter){name ? ` · ${name}` : ""}
      </p>
      <pre className="mb-4 max-h-96 overflow-auto rounded-lg border border-line bg-page p-3 font-mono text-xs leading-relaxed text-fg-muted">
        {frontMatter}
      </pre>
      <MarkdownView content={body} />
    </div>
  );
}

/** Группа пресетов одного режима + чип Custom (появляется при отклонении от пресета). */
function ThemeGroup({
  title,
  mode,
  draft,
  saved,
  onSelect,
}: {
  title: string;
  mode: ThemeMode;
  draft: SlotDraft;
  saved: ThemeTokens;
  onSelect: (presetId: string) => void;
}) {
  const presets = presetsFor(mode);
  const preset = activePreset(mode, draft);
  const dirty = isDirty(mode, draft, saved);
  const final = finalTokens(draft);
  return (
    <Panel title={title}>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              aria-pressed={active}
              className={`flex w-40 flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                active ? "border-accent bg-accent/10" : "border-line bg-raised/40 hover:border-line-strong"
              }`}
            >
              <ThemeSwatches tokens={p.tokens.colors} page={p.tokens.colors.page} />
              <span className={`text-xs font-medium ${active ? "text-accent" : "text-fg"}`}>{p.name}</span>
            </button>
          );
        })}
        {!preset ? (
          <div
            aria-pressed="true"
            className="flex w-40 flex-col gap-2 rounded-lg border border-accent bg-accent/10 p-2.5 text-left"
          >
            <ThemeSwatches tokens={final.colors} page={final.colors.page} />
            <span className="text-xs font-medium text-accent">
              Custom{dirty ? "" : " (сохранённая)"}
            </span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ThemeSwatches({ tokens, page }: { tokens: Record<ColorRole, string>; page: string }) {
  return (
    <span className="flex h-6 overflow-hidden rounded-md border border-line">
      <span className="h-full w-1/4" style={{ backgroundColor: page }} />
      <span className="h-full w-1/4" style={{ backgroundColor: tokens.surface }} />
      <span className="h-full w-1/4" style={{ backgroundColor: tokens.accent }} />
      <span className="h-full w-1/4" style={{ backgroundColor: tokens.fg }} />
    </span>
  );
}
