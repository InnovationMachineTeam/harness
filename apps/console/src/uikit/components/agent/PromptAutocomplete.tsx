"use client";

import { useEffect, useMemo, useRef } from "react";
import { cx, Loading } from "@/uikit";

/**
 * Меню автодополнения композера "Агент": группы slash-команд (мастер-навыки,
 * агенты, workflow) и результаты поиска файлов и папок для @-упоминаний.
 * Компонент показной: список, активная строка и выбор управляются родителем
 * (AgentPanel) - клавиатура обрабатывается на textarea.
 */

export interface SlashMenuItem {
  group: string;
  /** Вставляемый токен: "/master:id", "/agent:id", "/workflow:id", "/name", "@путь". */
  token: string;
  label: string;
  description: string;
  /** Папка в результатах @-поиска: выбор открывает её, а не вставляет токен. */
  dir?: boolean;
}

export interface ActiveMenu {
  kind: "slash" | "file";
  query: string;
  /** Позиция символа-триггера ("/" или "@") в тексте ввода. */
  start: number;
  /** Позиция каретки в момент открытия. */
  end: number;
}

export function PromptAutocomplete(props: {
  items: SlashMenuItem[];
  activeIndex: number;
  loading?: boolean;
  /** Подпапка @-навигации (показывает пункт возврата). */
  canNavigateUp?: boolean;
  onHover: (index: number) => void;
  onPick: (item: SlashMenuItem) => void;
  onNavigate?: (relPath: string) => void;
  onNavigateUp?: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsKey = useMemo(() => props.items.map((item) => item.token).join("\n"), [props.items]);

  // Навигация стрелками сопровождается скроллом: активная позиция держится
  // в середине видимой части списка.
  useEffect(() => {
    const container = containerRef.current;
    const active = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !active) return;
    const target = active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2;
    container.scrollTop = Math.max(0, target);
  }, [props.activeIndex, itemsKey, props.loading, props.canNavigateUp]);

  const groups = useMemo(() => {
    const map = new Map<string, SlashMenuItem[]>();
    for (const item of props.items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [props.items]);

  if (!props.items.length && !props.loading && !props.canNavigateUp) return null;
  let itemIndex = props.canNavigateUp ? 1 : 0;
  return (
    <div ref={containerRef} className="relative mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface p-1" role="listbox" aria-label="меню команд">
      {props.canNavigateUp ? (
        <button
          type="button"
          role="option"
          aria-selected={props.activeIndex === 0}
          data-active={props.activeIndex === 0 ? "true" : undefined}
          className={cx("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs", props.activeIndex === 0 ? "bg-info/10 text-info" : "text-fg hover:bg-surface/80")}
          onMouseEnter={() => props.onHover(0)}
          onClick={() => props.onNavigateUp?.()}
        >
          <span className="font-mono">…/</span>
          <span className="text-fg-faint">на уровень выше</span>
        </button>
      ) : null}
      {props.loading ? <div className="px-2 py-1"><Loading>поиск файлов…</Loading></div> : null}
      {groups.map(([group, items]) => (
        <div key={group}>
          <p className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-fg-faint">{group}</p>
          {items.map((item) => {
            const active = itemIndex === props.activeIndex;
            const current = itemIndex;
            itemIndex += 1;
            return (
              <button
                key={item.token + String(current)}
                type="button"
                role="option"
                aria-selected={active}
                data-active={active ? "true" : undefined}
                className={cx("flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs", active ? "bg-info/10 text-info" : "text-fg hover:bg-surface/80")}
                onMouseEnter={() => props.onHover(current)}
                onClick={() => (item.dir ? props.onNavigate?.(item.token.slice(1)) : props.onPick(item))}
              >
                <span className="shrink-0 font-mono">{item.dir ? item.token + "/" : item.token}</span>
                {item.description ? <span className="truncate text-fg-faint">{item.description}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
      {props.items.length ? (
        <button type="button" className="mt-0.5 w-full rounded px-2 py-1 text-left text-[10px] text-fg-faint hover:text-fg" onClick={props.onClose}>
          Esc - закрыть меню
        </button>
      ) : null}
    </div>
  );
}
