"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { MarkdownView, splitFrontMatter } from "@/uikit/components/memory/MarkdownView";
import { postJson, type LintFinding } from "@/uikit/components/design/design-api";
import { applyMultipliers, IDENTITY, isIdentity, radiusToPx, type Multipliers } from "@/lib/color";
import { buildDesignFile, parseDesign } from "@/lib/design-format";
import { ROLE_GROUPS, ROLE_LABELS, type ColorRole, type ThemeTokens } from "@/lib/themes";
import { Button, Chip, ColorSwatch, FieldLabel, Input, Notice, Panel, Segmented, Select, type SelectOption } from "@/uikit";

/**
 * Редактор DESIGN.md рабочей папки: пресеты themes/ как база, свотчи ролей,
 * слайдеры-мультипликаторы (lib/color), предпросмотр собранного файла и гайда,
 * сохранение через POST /api/design/workspace {action:"save-design"} с lint.
 * Стор темы консоли ("Настройки → Внешний вид") не затрагивается.
 */

interface ThemeIndexEntry {
  file: string;
  name: string;
  mode: "dark" | "light";
}

const SLIDERS: { key: keyof Multipliers; label: string; min: number; max: number; step: number }[] = [
  { key: "saturation", label: "Насыщенность", min: 0, max: 2, step: 0.01 },
  { key: "surfaceLight", label: "Светлота поверхностей", min: 0.8, max: 1.3, step: 0.01 },
  { key: "textContrast", label: "Контраст текста", min: 0.7, max: 1.3, step: 0.01 },
  { key: "accentLight", label: "Яркость акцентов", min: 0.8, max: 1.3, step: 0.01 },
  { key: "roundness", label: "Скруглённость", min: 0, max: 2, step: 0.05 },
];

export function DesignTokensEditor(props: {
  dir: string;
  design: { exists: boolean; name: string; tokens: ThemeTokens | null; content: string; lintErrors: number; lintWarnings: number };
  presets: ThemeIndexEntry[];
  /** Рост значения перезагружает форму из props (после сохранения/действий пакета). */
  revision: number;
  onSaved: () => Promise<void> | void;
}) {
  const [doc, setDoc] = useState("");
  const [base, setBase] = useState<ThemeTokens | null>(null);
  const [baseName, setBaseName] = useState("");
  const [mult, setMult] = useState<Multipliers>(IDENTITY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<LintFinding[] | null>(null);
  const [view, setView] = useState<"file" | "guide">("file");
  const [presetFile, setPresetFile] = useState("");

  /** Загрузка формы из файла/пресета: по revision (и на первом монтировании). Несохранённый черновик не перезаписывается. */
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    const { design, presets } = props;
    if (design.exists && design.tokens) {
      setDoc(design.content);
      setBase(design.tokens);
      setBaseName(design.name);
      setMult(IDENTITY);
      setFindings(null);
      setError(null);
      return;
    }
    const first = presets[0];
    if (first) void loadPreset(first.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.revision, props.presets.length]);

  /** Пресет themes/ - новая база формы (на диск не пишется до "Сохранить"). */
  const loadPreset = async (file: string) => {
    setPresetFile(file);
    try {
      const data = await fetch(`/api/design/theme?file=${encodeURIComponent(file)}`).then((r) => r.json());
      if (data.error) throw new Error(data.error);
      const parsed = parseDesign(data.content as string);
      setDoc(data.content as string);
      setBase(parsed.tokens);
      setBaseName(parsed.name);
      setMult(IDENTITY);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const final = useMemo(() => (base ? applyMultipliers(base, mult) : null), [base, mult]);
  const nameValue = baseName;
  const dirty = Boolean(base && final && (!isIdentity(mult) || JSON.stringify(final) !== JSON.stringify(base) || nameValue !== baseName));
  dirtyRef.current = dirty;
  const rendered = useMemo(() => (base && final ? buildDesignFile(doc, final, nameValue || "Custom") : ""), [base, final, doc, nameValue]);
  const guide = useMemo(() => splitFrontMatter(rendered).body, [rendered]);

  /** Прямая правка роли сбрасывает слайдеры: множители считаются от новой базы. */
  const setRole = (role: ColorRole, hex: string) => {
    if (!base) return;
    setMult(IDENTITY);
    setBase({ ...base, colors: { ...base.colors, [role]: hex } });
  };

  const setRadius = (key: "md" | "lg" | "xl", value: string) => {
    if (!base) return;
    setMult(IDENTITY);
    setBase({ ...base, rounded: { ...base.rounded, [key]: value } });
  };

  const save = async () => {
    if (!final) return;
    setSaving(true);
    setError(null);
    try {
      const result = await postJson<{ ok: boolean; name: string; findings: LintFinding[] }>("/api/design/workspace", {
        action: "save-design",
        dir: props.dir,
        tokens: final,
        name: nameValue,
      });
      setFindings(result.findings ?? []);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!base || !final) return null;
  const presetOptions: SelectOption[] = props.presets.map((item) => ({
    value: item.file,
    label: `${item.name} (${item.mode === "dark" ? "тёмная" : "светлая"})`,
  }));

  return (
    <Panel
      title="DESIGN.md - визуальные токены"
      actions={
        <>
          {dirty ? <Chip tone="amber">не сохранено</Chip> : <Chip tone="emerald">сохранено</Chip>}
          <Button variant="ghostDim" disabled={saving} onClick={() => setMult(IDENTITY)}>
            <RotateCcw size={12} aria-hidden /> Слайдеры
          </Button>
          <Button variant="accent" disabled={saving} onClick={() => void save()}>
            <Save size={12} aria-hidden /> Сохранить в DESIGN.md
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <FieldLabel htmlFor="design-tokens-preset">Пресет (база формы)</FieldLabel>
          <Select id="design-tokens-preset" value={presetFile} options={presetOptions} onChange={(value) => void loadPreset(value)} />
        </div>
        <div className="min-w-44">
          <FieldLabel htmlFor="design-tokens-name">Имя темы</FieldLabel>
          <Input id="design-tokens-name" value={nameValue} onChange={(event) => setBaseName(event.target.value)} spellCheck={false} />
        </div>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
        {ROLE_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">{group.title}</p>
            <div className="space-y-1">
              {group.roles.map((role) => (
                <div key={role} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted" title={ROLE_LABELS[role]}>{ROLE_LABELS[role]}</span>
                  <ColorSwatch
                    label={`цвет ${ROLE_LABELS[role]}`}
                    value={final.colors[role]}
                    onChange={(hex) => setRole(role, hex)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Радиусы</p>
          <div className="space-y-1">
            {(["md", "lg", "xl"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-fg-muted">rounded-{key}</span>
                <Input
                  value={final.rounded[key]}
                  onChange={(event) => setRadius(key, event.target.value)}
                  aria-label={`радиус ${key}`}
                  className="w-[4.5rem] font-mono text-[11px]"
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
        {SLIDERS.map((slider) => (
          <label key={slider.key} className="flex items-center gap-2 text-[11px] text-fg-muted">
            <span className="min-w-0 flex-1 truncate">{slider.label}</span>
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={mult[slider.key]}
              onChange={(event) => setMult({ ...mult, [slider.key]: Number(event.target.value) })}
              onDoubleClick={() => setMult({ ...mult, [slider.key]: 1 })}
              className="w-36 accent-accent"
              aria-label={slider.label}
            />
            <span className="w-10 text-right font-mono text-[10px] text-fg-faint">
              {slider.key === "roundness" ? `${radiusToPx(final.rounded.md)}px` : `${Math.round(mult[slider.key] * 100)}%`}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4">
        <Segmented
          ariaLabel="вид предпросмотра DESIGN.md"
          value={view}
          onChange={setView}
          options={[
            { key: "file", label: "Файл" },
            { key: "guide", label: "Гайд" },
          ]}
        />
        {view === "file" ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-page/60 p-3 text-[11px] leading-relaxed text-fg-muted">{rendered}</pre>
        ) : (
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line p-3">
            <MarkdownView content={guide} />
          </div>
        )}
      </div>

      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      {findings ? (
        findings.length === 0 ? (
          <Notice tone="success" className="mt-3">lint: замечаний нет</Notice>
        ) : (
          <Notice tone="info" className="mt-3">
            {findings.map((finding, index) => (
              <span key={index} className="block">
                {finding.severity === "error" ? "ошибка" : "предупреждение"} · {finding.rule}: {finding.message}
              </span>
            ))}
          </Notice>
        )
      ) : null}
    </Panel>
  );
}
