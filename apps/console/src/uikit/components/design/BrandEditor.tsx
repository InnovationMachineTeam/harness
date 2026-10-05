"use client";

import { useEffect, useRef, useState } from "react";
import { FilePlus2, Save, Sparkles } from "lucide-react";
import { MarkdownSectionsEditor } from "@/uikit/components/design/MarkdownSectionsEditor";
import { postJson } from "@/uikit/components/design/design-api";
import { Button, EmptyState, Notice, Panel } from "@/uikit";

/**
 * Редактор BRAND.md рабочей папки (бренд-паспорт): секционные карточки по
 * заголовкам H2 (MarkdownEditor с подсветкой), правка исходника и
 * предпросмотр. Создание по шаблону, заполнение задачей (open-design/рантайм),
 * сохранение через POST /api/design/workspace {action:"save-brand"}.
 * Синхронизация (harness-design) и рантаймы видят файл сразу после сохранения.
 */

export function BrandEditor(props: {
  dir: string;
  brand: { exists: boolean };
  /** Рост значения перезагружает черновик из файла (после сохранения/действий пакета). */
  revision: number;
  content: string;
  onSaved: () => Promise<void> | void;
  /** Префилл панели "Задача" (заполнение бренда из артефактов). */
  onTask: () => void;
}) {
  const [draft, setDraft] = useState(props.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const revisionRef = useRef(props.revision);
  const dirtyRef = useRef(false);
  dirtyRef.current = draft !== props.content;

  /** Новый файл с сервера (создание/смена папки) - черновик обновляется; несохранённые правки не теряются. */
  useEffect(() => {
    if (revisionRef.current === props.revision || dirtyRef.current) return;
    revisionRef.current = props.revision;
    setDraft(props.content);
    setError(null);
  }, [props.revision, props.content]);

  const save = async (content: string) => {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/design/workspace", { action: "save-brand", dir: props.dir, content });
      setDraft(content);
      setSavedAt(Date.now());
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const createFromTemplate = async () => {
    try {
      const data = await postJson<{ content: string }>("/api/design/workspace", { action: "brand-template", dir: props.dir });
      await save(data.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!props.brand.exists && draft.trim() === "") {
    return (
      <Panel title="BRAND.md - бренд-паспорт">
        <EmptyState size="sm">
          Файла нет. Он описывает имя и суть бренда, аудиторию, тон коммуникации и фирменные элементы; значения цветов остаются в DESIGN.md.
        </EmptyState>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={saving} onClick={() => void createFromTemplate()}>
            <FilePlus2 size={12} aria-hidden /> Создать по шаблону
          </Button>
          <Button variant="ghostDim" onClick={props.onTask}>
            <Sparkles size={12} aria-hidden /> Заполнить задачей (open-design)
          </Button>
        </div>
        {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      </Panel>
    );
  }

  const dirty = draft !== props.content;
  return (
    <Panel
      title="BRAND.md - бренд-паспорт"
      actions={
        <>
          {dirty ? <span className="text-[11px] text-warning">не сохранено · {draft.length} симв.</span> : savedAt ? <span className="text-[11px] text-fg-faint">сохранено</span> : null}
          <Button variant="accent" disabled={saving || !draft.trim()} onClick={() => void save(draft)}>
            <Save size={12} aria-hidden /> Сохранить
          </Button>
        </>
      }
    >
      <MarkdownSectionsEditor value={draft} onChange={setDraft} ariaLabel="BRAND.md" rows={10} />
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </Panel>
  );
}
