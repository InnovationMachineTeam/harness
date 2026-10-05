"use client";

import { useMemo, useState } from "react";
import YAML from "yaml";
import { Button, Footnote, Modal, Notice, Segmented, Textarea } from "@/uikit";
import { EFFORT_LEVELS, MODEL_TIERS } from "@/core/workflows/schema";
import {
  asStringList,
  ChipsField,
  FormSection,
  SelectField,
  TextField,
} from "./editor-shared";

export type ChipOption = { value: string; label: string };

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: text };
  try {
    return { frontmatter: (YAML.parse(text.slice(4, end)) ?? {}) as Record<string, unknown>, body: text.slice(end + 5) };
  } catch {
    return { frontmatter: {}, body: text };
  }
}

function serializeRole(frontmatter: Record<string, unknown>, body: string): string {
  return "---\n" + YAML.stringify(frontmatter, { lineWidth: 0 }) + "---\n\n" + body.replace(/^\n+/, "");
}

export function RoleEditorModal({
  roleId,
  folder,
  text,
  skillOptions,
  mcpOptions,
  toolOptions,
  onTextChange,
  onDelete,
  onClose,
  onSave,
}: {
  roleId: string;
  folder: string;
  text: string;
  skillOptions: ChipOption[];
  mcpOptions: ChipOption[];
  toolOptions: ChipOption[];
  onTextChange: (next: string) => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
  onSave: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [segment, setSegment] = useState<"form" | "source">("form");
  const [saveState, setSaveState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const parsed = useMemo(() => splitFrontmatter(text), [text]);
  const frontmatter = parsed.frontmatter;

  const updateFrontmatter = (updates: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...frontmatter, ...updates };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "") delete next[key];
    }
    onTextChange(serializeRole(next, parsed.body));
  };

  const updateBody = (body: string) => onTextChange(serializeRole(frontmatter, body));

  const save = async () => setSaveState(await onSave());
  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-5xl"
      title={`Роль: ${String(frontmatter.title ?? roleId)}`}
      description={`Файл .agents/roles/${folder ? folder + "/" : ""}${roleId}.md - YAML frontmatter и markdown-инструкции одной роли.`}
      footer={
        <>
          <Button variant="danger" disabled={deleting} onClick={remove} className="mr-auto">Удалить роль</Button>
          {saveState ? <span className={`mr-2 text-xs ${saveState.ok ? "text-accent" : "text-danger"}`}>{saveState.ok ? "Сохранено" : saveState.error ?? "Ошибка сохранения"}</span> : null}
          <Button variant="primary" onClick={save}>Validate &amp; save</Button>
          <Button onClick={onClose}>Закрыть</Button>
        </>
      }
    >
      <Segmented
        className="mb-3 w-fit max-w-full"
        ariaLabel="Режим редактора роли"
        value={segment}
        onChange={setSegment}
        options={[
          { key: "form", label: "Форма + Markdown" },
          { key: "source", label: "Исходник файла" },
        ]}
      />
      {!Object.keys(frontmatter).length ? <Notice tone="error" className="mb-3">Frontmatter файла не парсится или пуст.</Notice> : null}
      {segment === "source" ? (
        <div className="space-y-2">
          <Textarea value={text} onChange={(e) => onTextChange(e.target.value)} rows={24} className="h-[60vh] w-full resize-none font-mono text-[11px]" spellCheck={false} />
          <Footnote>Правки применяются к тому же тексту, что и форма; сохранение - по кнопке ниже.</Footnote>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <div className="h-[60vh] space-y-3 overflow-y-auto pr-1">
            <FormSection title="Frontmatter">
              <div className="grid grid-cols-2 gap-2">
                <TextField label="ID (из файла)" value={String(frontmatter.id ?? roleId)} onChange={() => {}} mono disabled />
                <TextField label="Название" value={String(frontmatter.title ?? "")} onChange={(title) => updateFrontmatter({ title })} />
                <TextField label="Домен (для группировки)" value={String(frontmatter.domain ?? "")} onChange={(domain) => updateFrontmatter({ domain })} placeholder="product, frontend, security" />
                <SelectField label="defaultTier" allowEmpty value={String(frontmatter.defaultTier ?? "")} options={MODEL_TIERS.map((value) => ({ value, label: value }))} onChange={(defaultTier) => updateFrontmatter({ defaultTier: defaultTier || undefined })} />
                <SelectField label="defaultEffort" allowEmpty value={String(frontmatter.defaultEffort ?? "")} options={EFFORT_LEVELS.map((value) => ({ value, label: value }))} onChange={(defaultEffort) => updateFrontmatter({ defaultEffort: defaultEffort || undefined })} />
              </div>
              <ChipsField label="skills (внешние навыки)" value={asStringList(frontmatter.skills)} options={skillOptions} onChange={(skills) => updateFrontmatter({ skills })} addLabel="Добавить навык" />
              <div className="grid grid-cols-2 gap-2">
                <ChipsField label="mcp" value={asStringList(frontmatter.mcp)} options={mcpOptions} onChange={(mcp) => updateFrontmatter({ mcp })} addLabel="Добавить MCP" />
                <ChipsField label="tools" value={asStringList(frontmatter.tools)} options={toolOptions} onChange={(tools) => updateFrontmatter({ tools })} addLabel="Добавить инструмент" />
              </div>
            </FormSection>
          </div>
          <div className="h-[60vh] overflow-y-auto">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Инструкции роли (Markdown)</p>
            <Textarea value={parsed.body} onChange={(e) => updateBody(e.target.value)} rows={24} className="h-[54vh] w-full resize-none font-mono text-[11px]" spellCheck={false} />
            <Footnote className="mt-1">Секции: # Роль; ## Правила работы; ## Принципы работы; ## Оценка входных данных; ## Оценка своей работы. Всё тело попадает в промпт шага.</Footnote>
          </div>
        </div>
      )}
    </Modal>
  );
}
