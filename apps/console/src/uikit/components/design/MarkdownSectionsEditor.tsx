"use client";

import { useMemo, useState } from "react";
import { MarkdownView } from "@/uikit/components/memory/MarkdownView";
import {
  composeMarkdownSection,
  joinMarkdownSections,
  markdownSectionBody,
  splitMarkdownSections,
} from "@/lib/markdown-sections";
import { cx, EmptyState, SectionLabel, Segmented } from "@/uikit";
import { MarkdownEditor } from "@/uikit/components/MarkdownEditor";

/**
 * Секционный редактор markdown-документа: документ делится по заголовкам H2
 * на карточки (каждая - MarkdownEditor с подсветкой синтаксиса), режимы
 * "Секции / Исходник / Предпросмотр". Склейка дословная - структура заголовков
 * сохраняется; разбор и склейку выполняет lib/markdown-sections.
 * Компонент управляемый: текст приходит и уходит через value/onChange.
 */

type SectionsMode = "sections" | "source" | "preview";

interface SectionCard {
  key: string;
  title: string;
  body: string;
  /** Индекс секции в разборе; -1 - преамбула (текст до первого H2). */
  index: number;
}

export function MarkdownSectionsEditor(props: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  rows?: number;
}) {
  const [mode, setMode] = useState<SectionsMode>("sections");
  const [selected, setSelected] = useState(0);
  const parts = useMemo(() => splitMarkdownSections(props.value), [props.value]);

  const cards: SectionCard[] = [
    ...(parts.preamble.trim() !== "" ? [{ key: "preamble", title: "Вступление", body: parts.preamble, index: -1 }] : []),
    ...parts.sections.map((section, index) => ({
      key: `section-${index}`,
      title: section.title !== "" ? section.title : section.heading,
      body: markdownSectionBody(section),
      index,
    })),
  ];
  const active = cards.length > 0 ? cards[Math.min(selected, cards.length - 1)]! : null;

  const setBody = (card: SectionCard, body: string) => {
    if (card.index < 0) {
      props.onChange(joinMarkdownSections({ preamble: body, sections: parts.sections }));
      return;
    }
    props.onChange(
      joinMarkdownSections({
        preamble: parts.preamble,
        sections: parts.sections.map((section, index) => (index === card.index ? composeMarkdownSection(section, body) : section)),
      }),
    );
  };

  const segmented = (
    <Segmented
      ariaLabel={props.ariaLabel}
      value={mode}
      onChange={setMode}
      options={[
        { key: "sections", label: "Секции", count: cards.length },
        { key: "source", label: "Исходник" },
        { key: "preview", label: "Предпросмотр" },
      ]}
    />
  );

  if (mode === "preview") {
    return (
      <div className="flex flex-col gap-2">
        {segmented}
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-line p-3">
          <MarkdownView content={props.value} />
        </div>
      </div>
    );
  }

  if (mode === "source") {
    return (
      <div className="flex flex-col gap-2">
        {segmented}
        <MarkdownEditor
          value={props.value}
          onChange={props.onChange}
          rows={props.rows ?? 18}
          ariaLabel={`${props.ariaLabel} - исходник`}
        />
      </div>
    );
  }

  if (!active) {
    return (
      <div className="flex flex-col gap-2">
        {segmented}
        <EmptyState size="sm">Секций H2 нет - правьте документ в режиме "Исходник".</EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {segmented}
      <div className="flex flex-wrap items-start gap-3">
        <nav aria-label={`Секции: ${props.ariaLabel}`} className="flex w-44 shrink-0 flex-col gap-1">
          {cards.map((card, index) => (
            <button
              key={card.key}
              type="button"
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
              className={cx(
                "truncate rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
                card === active
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line-strong text-fg-muted hover:bg-raised hover:text-fg",
              )}
            >
              {card.title}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <SectionLabel className="mb-1.5">
            {active.index >= 0 ? parts.sections[active.index]!.heading : "Вступление"}
          </SectionLabel>
          <MarkdownEditor
            key={active.key}
            value={active.body}
            onChange={(body) => setBody(active, body)}
            rows={props.rows ?? 12}
            ariaLabel={`${props.ariaLabel} - секция "${active.title}"`}
          />
        </div>
      </div>
    </div>
  );
}
