"use client";

import { useRef, useState, type ReactNode } from "react";
import YAML from "yaml";
import { Button, Chip, FieldLabel, Footnote, Input, Select, Textarea, Toggle } from "@/uikit";

export type YamlParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function parseYamlSafe(text: string): YamlParseResult {
  try {
    return { ok: true, value: YAML.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Заменяет элемент массива `key` (nodes/roles) в YAML-документе по полю id.
 * Возвращает новый текст документа; null - документ не парсится или массива нет.
 */
export function spliceEntity(yaml: string, key: "nodes" | "roles", entity: Record<string, unknown>): string | null {
  const parsed = parseYamlSafe(yaml);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return null;
  const doc = parsed.value as Record<string, unknown>;
  const list = doc[key];
  if (!Array.isArray(list)) return null;
  const id = String(entity.id);
  const index = list.findIndex((item) => (item as Record<string, unknown>)?.id === id);
  const next = [...list];
  if (index >= 0) next[index] = entity;
  else next.push(entity);
  return YAML.stringify({ ...doc, [key]: next }, { lineWidth: 0 });
}

export function yamlOf(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 0 });
}

/** Удаляет узел workflow и ссылки на него из dependsOn остальных узлов. Возвращает null при ошибке разбора. */
export function removeNodeFromYaml(yaml: string, nodeId: string): string | null {
  return mapWorkflowNodes(yaml, (nodes) => nodes
    .filter((item) => item?.id !== nodeId)
    .map((item) => (Array.isArray(item.dependsOn) ? { ...item, dependsOn: item.dependsOn.filter((dep) => dep !== nodeId) } : item)));
}

/** Применяет преобразование к массиву nodes и пересериализует документ. */
function mapWorkflowNodes(yaml: string, mutate: (nodes: Record<string, unknown>[]) => Record<string, unknown>[]): string | null {
  const parsed = parseYamlSafe(yaml);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return null;
  const doc = parsed.value as Record<string, unknown>;
  if (!Array.isArray(doc.nodes)) return null;
  const nodes = mutate(doc.nodes.map((item) => asRecord(item)));
  return YAML.stringify({ ...doc, nodes }, { lineWidth: 0 });
}

/** Переименование шага: id, ссылки dependsOn, входы и автоартефакты во всём файле. */
export function renameStepInYaml(yaml: string, oldId: string, newId: string): string | null {
  return mapWorkflowNodes(yaml, (nodes) => nodes.map((item) => {
    const renamed = (value: unknown) => (Array.isArray(value) ? value.map((entry) => (entry === oldId ? newId : entry)) : value);
    const next = { ...item, dependsOn: renamed(item.dependsOn), inputs: renamed(item.inputs), outputs: renamed(item.outputs) };
    return item.id === oldId ? { ...next, id: newId } : next;
  }));
}

/** Удаление чипа входа: имя уходит из inputs; связь-поставщик разрывается, если её артефакты больше не нужны. */
export function removeInputChip(yaml: string, nodeId: string, name: string): string | null {
  return mapWorkflowNodes(yaml, (nodes) => {
    const self = nodes.find((item) => item.id === nodeId);
    if (!self) return nodes;
    const inputs = asStringList(self.inputs).filter((entry) => entry !== name);
    let dependsOn = asStringList(self.dependsOn);
    for (const dep of [...dependsOn]) {
      const source = nodes.find((item) => item.id === dep);
      const outputs = asStringList(source?.outputs);
      if (outputs.length && !inputs.some((input) => outputs.includes(input))) {
        dependsOn = dependsOn.filter((entry) => entry !== dep);
      }
    }
    return nodes.map((item) => (item.id === nodeId ? { ...item, inputs, dependsOn } : item));
  });
}

/** Удаление чипа выхода: имя уходит из outputs; у приёмников чистится вход и связь, если их входы не покрыты. */
export function removeOutputChip(yaml: string, nodeId: string, name: string): string | null {
  return mapWorkflowNodes(yaml, (nodes) => {
    const self = nodes.find((item) => item.id === nodeId);
    if (!self) return nodes;
    const outputs = asStringList(self.outputs).filter((entry) => entry !== name);
    return nodes.map((item) => {
      if (item.id === nodeId) return { ...item, outputs };
      const dependsOn = asStringList(item.dependsOn);
      if (!dependsOn.includes(nodeId)) return item;
      const inputs = asStringList(item.inputs).filter((entry) => entry !== name);
      const stillFed = inputs.some((input) => outputs.includes(input));
      return { ...item, inputs, dependsOn: stillFed ? dependsOn : dependsOn.filter((entry) => entry !== nodeId) };
    });
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/* ------------------------------- поля формы ------------------------------- */

/** Список рантаймов harness - источник чипов Runtime candidates. */
export const RUNTIME_OPTIONS = ["claude", "codex", "cursor", "kimi", "zcode", "opencode"].map((value) => ({ value, label: value }));

export function TextField({ label, value, onChange, mono, disabled, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><Input disabled={disabled} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 w-full text-xs ${mono ? "font-mono" : ""}`} /></label>;
}

export function NumberField({ label, value, onChange, min, max }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><Input type="number" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full font-mono text-xs" /></label>;
}

export function TextareaField({ label, value, onChange, rows = 3, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><Textarea rows={rows} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full text-xs" /></label>;
}

export function ListField({ label, value, onChange, placeholder }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><Input placeholder={placeholder} value={value.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((part) => part.trim()).filter(Boolean))} className="mt-1 w-full font-mono text-xs" /></label>;
}

export function LinesField({ label, value, onChange, rows = 3 }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  rows?: number;
}) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><Textarea rows={rows} value={value.join("\n")} onChange={(e) => onChange(e.target.value.split("\n").map((part) => part.trim()).filter(Boolean))} className="mt-1 w-full text-xs" /></label>;
}

export function SelectField({ label, value, options, onChange, allowEmpty, emptyLabel = "- не задана -" }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const known = value === "" || options.some((option) => option.value === value);
  const all = known ? options : [{ value, label: `${value} (из файла)` }, ...options];
  return <label className="block"><FieldLabel>{label}</FieldLabel><Select value={value} options={allowEmpty ? [{ value: "", label: emptyLabel }, ...all] : all} onChange={onChange} className="mt-1 w-full" ariaLabel={label} /></label>;
}

/** Мультивыбор ролями: выбранные значения - чипы, добавление - выпадающий список доступных. */
export function ChipsField({ label, value, options, onChange, addLabel = "Добавить роль", placeholder, sortable, emptyHint }: {
  label: string;
  value: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (next: string[]) => void;
  addLabel?: string;
  placeholder?: string;
  /** Чипы перетаскиваются мышью: порядок списка меняется drag-and-drop. */
  sortable?: boolean;
  emptyHint?: string;
}) {
  const dragIndex = useRef<number | null>(null);
  const known = new Set(options.map((option) => option.value));
  const available = options.filter((option) => !value.includes(option.value));
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  return <div className="block"><FieldLabel>{label}</FieldLabel>
    {value.length ? <div className="mt-1 flex flex-wrap gap-1">{value.map((id, index) => (
      <Chip
        key={id}
        tone={known.has(id) ? "sky" : "red"}
        mono
        title={known.has(id) ? (sortable ? "Убрать; перетащите, чтобы изменить порядок" : "Убрать") : "Отсутствует в каталоге; убрать"}
        draggable={sortable}
        onDragStart={() => { dragIndex.current = index; }}
        onDragOver={(event) => { if (sortable) event.preventDefault(); }}
        onDrop={() => { if (dragIndex.current !== null) reorder(dragIndex.current, index); dragIndex.current = null; }}
        onClick={() => onChange(value.filter((item) => item !== id))}
      >{id} ×</Chip>
    ))}</div> : emptyHint ? <Footnote className="mt-1">{emptyHint}</Footnote> : null}
    {available.length ? <Select value="" onChange={(next) => next && onChange([...value, next])} options={[{ value: "", label: placeholder ?? addLabel }, ...available]} className="mt-1 w-full" ariaLabel={label} /> : <Footnote className="mt-1">Доступные значения исчерпаны</Footnote>}
  </div>;
}

export function ToggleField({ label, value, onChange, title }: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  title?: string;
}) {
  return <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5" title={title}>
    <FieldLabel>{label}</FieldLabel>
    <Toggle checked={value} onChange={onChange} ariaLabel={label} />
  </div>;
}

/**
 * Чипы артефактов (inputs/outputs): клик по чипу удаляет его через onRemove
 * (для inputs это разрывает связь на канве), добавление - списком опций
 * и/или свободным вводом имени.
 */
export function ArtifactChipsField({ label, value, options, onChange, onRemove, allowCustom = false, addLabel = "Добавить" }: {
  label: string;
  value: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (next: string[]) => void;
  onRemove: (name: string) => void;
  allowCustom?: boolean;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState("");
  const known = new Set(options.map((option) => option.value));
  const add = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setDraft("");
  };
  return <div className="block">
    <FieldLabel>{label}</FieldLabel>
    {value.length ? <div className="mt-1 flex flex-wrap gap-1">{value.map((name) => (
      <Chip key={name} tone={known.has(name) ? "sky" : "neutral"} mono title="Убрать" onClick={() => onRemove(name)}>{name} ×</Chip>
    ))}</div> : null}
    <div className="mt-1 flex items-center gap-1">
      {options.length ? <Select value="" onChange={(next) => next && add(next)} options={[{ value: "", label: addLabel }, ...options]} className="flex-1" ariaLabel={label} /> : null}
      {allowCustom ? <>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="имя артефакта" className="w-36 text-xs" />
        <Button size="sm" onClick={() => add(draft)}>+</Button>
      </> : null}
    </div>
  </div>;
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">{title}</p>{children}</section>;
}
