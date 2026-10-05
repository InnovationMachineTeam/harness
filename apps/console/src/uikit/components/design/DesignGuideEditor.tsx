"use client";

import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { MarkdownSectionsEditor } from "@/uikit/components/design/MarkdownSectionsEditor";
import { postJson } from "@/uikit/components/design/design-api";
import { FRONT_MATTER_RE } from "@/lib/design-format";
import { Button, EmptyState, Notice, Panel } from "@/uikit";

/**
 * Редактор гайда DESIGN.md (markdown-тело после front matter): секционные
 * карточки с подсветкой синтаксиса, правка исходника и предпросмотр.
 * Front matter с токенами не изменяется: сохранение - POST
 * /api/design/workspace {action:"save-design-guide"}; ошибки линта на сервере
 * запись запрещают. Значения токенов правятся на вкладке "Токены".
 */

export function DesignGuideEditor(props: {
  dir: string;
  design: { exists: boolean; content: string };
  /** Рост значения перезагружает черновик из файла (после сохранения/действий пакета). */
  revision: number;
  onSaved: () => Promise<void> | void;
}) {
  const serverBody = () => {
    const match = props.design.content.match(FRONT_MATTER_RE);
    return match ? props.design.content.slice(match[0].length) : props.design.content;
  };
  const [draft, setDraft] = useState(serverBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const revisionRef = useRef(props.revision);
  const dirtyRef = useRef(false);
  const server = serverBody();
  dirtyRef.current = draft !== server;

  /** Новый файл с сервера (создание пакета/смена папки) - черновик обновляется; несохранённые правки не теряются. */
  useEffect(() => {
    if (revisionRef.current === props.revision || dirtyRef.current) return;
    revisionRef.current = props.revision;
    setDraft(serverBody());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.revision, props.design.content]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/design/workspace", { action: "save-design-guide", dir: props.dir, content: draft });
      setSavedAt(Date.now());
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!props.design.exists && draft.trim() === "") {
    return (
      <Panel title="DESIGN.md - гайд">
        <EmptyState size="sm">
          Файла нет. Создайте дизайн-пакет на вкладке "Обзор" (кнопка "Создать из пресета") - гайд заполняется после этого.
        </EmptyState>
      </Panel>
    );
  }

  const dirty = draft !== server;
  return (
    <Panel
      title="DESIGN.md - гайд"
      actions={
        <>
          {dirty ? (
            <span className="text-[11px] text-warning">не сохранено · {draft.length} симв.</span>
          ) : savedAt ? (
            <span className="text-[11px] text-fg-faint">сохранено</span>
          ) : null}
          <Button variant="accent" disabled={saving || !draft.trim()} onClick={() => void save()}>
            <Save size={12} aria-hidden /> Сохранить
          </Button>
        </>
      }
    >
      <MarkdownSectionsEditor value={draft} onChange={setDraft} ariaLabel="гайд DESIGN.md" />
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </Panel>
  );
}
