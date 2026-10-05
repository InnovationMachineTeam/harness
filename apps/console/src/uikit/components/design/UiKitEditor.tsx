"use client";

import { useEffect, useRef, useState } from "react";
import { FilePlus2, Save } from "lucide-react";
import { MarkdownView } from "@/uikit/components/memory/MarkdownView";
import { postJson } from "@/uikit/components/design/design-api";
import { Button, EmptyState, Notice, Panel, Segmented } from "@/uikit";
import { MarkdownEditor } from "@/uikit/components/MarkdownEditor";

/**
 * Редактор design/ui-kit.md рабочей папки (правила интерфейса web и mobile):
 * создание по шаблону, правка в MarkdownEditor с подсветкой синтаксиса и
 * предпросмотр, сохранение через POST /api/design/workspace
 * {action:"save-uikit"}. Файл читают рантаймы (упомянут в managed-блоке
 * harness-design) и провайдер-задачи.
 */

export function UiKitEditor(props: {
  dir: string;
  uikit: { exists: boolean };
  content: string;
  /** Рост значения перезагружает черновик из файла (после сохранения/действий пакета). */
  revision: number;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(props.content);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revisionRef = useRef(props.revision);
  const dirtyRef = useRef(false);
  dirtyRef.current = draft !== props.content;

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
      await postJson("/api/design/workspace", { action: "save-uikit", dir: props.dir, content });
      setDraft(content);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const createFromTemplate = async () => {
    try {
      const data = await postJson<{ content: string }>("/api/design/workspace", { action: "uikit-template", dir: props.dir });
      await save(data.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!props.uikit.exists && draft.trim() === "") {
    return (
      <Panel title="ui-kit.md - правила интерфейса">
        <EmptyState size="sm">
          Файла нет. Он описывает правила интерфейса web и mobile: стек, примитивы кита, запреты; значения цветов остаются в DESIGN.md.
        </EmptyState>
        <div className="mt-3">
          <Button variant="primary" disabled={saving} onClick={() => void createFromTemplate()}>
            <FilePlus2 size={12} aria-hidden /> Создать по шаблону
          </Button>
        </div>
        {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      </Panel>
    );
  }

  const dirty = draft !== props.content;
  return (
    <Panel
      title="ui-kit.md - правила интерфейса"
      actions={
        <>
          {dirty ? <span className="text-[11px] text-warning">не сохранено · {draft.length} симв.</span> : null}
          <Button variant="accent" disabled={saving || !draft.trim()} onClick={() => void save(draft)}>
            <Save size={12} aria-hidden /> Сохранить
          </Button>
        </>
      }
    >
      <Segmented
        ariaLabel="режим ui-kit.md"
        value={view}
        onChange={setView}
        options={[
          { key: "edit", label: "Редактор" },
          { key: "preview", label: "Предпросмотр" },
        ]}
      />
      {view === "edit" ? (
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          rows={16}
          ariaLabel="содержимое ui-kit.md"
          className="mt-2"
        />
      ) : (
        <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-line p-3">
          <MarkdownView content={draft} />
        </div>
      )}
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </Panel>
  );
}
