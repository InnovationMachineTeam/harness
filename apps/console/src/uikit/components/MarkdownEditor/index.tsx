"use client";

/**
 * Редактор markdown с подсветкой синтаксиса: прозрачная textarea поверх
 * подсвеченной подложки (highlight.js, грамматика markdown). Оба слоя имеют
 * одинаковые метрики шрифта, отступы и правила переноса; прокрутка поля
 * синхронизирует подложку. Цвета подсветки - тема `.hljs-*` в globals.css
 * на дизайн-токенах.
 */

import { useMemo, useRef, type TextareaHTMLAttributes } from "react";
import { cx } from "../UIKit";
import { highlightToHtml } from "./highlight";

export function MarkdownEditor({
  value,
  onChange,
  rows = 14,
  ariaLabel,
  spellCheck = false,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "value" | "rows" | "children" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const backdropRef = useRef<HTMLPreElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  // Перенос строки в конце: последняя пустая строка подложки совпадает с полем.
  const html = useMemo(() => `${highlightToHtml(value, "markdown")}\n`, [value]);

  const syncScroll = () => {
    const field = fieldRef.current;
    const backdrop = backdropRef.current;
    if (!field || !backdrop) return;
    backdrop.scrollTop = field.scrollTop;
    backdrop.scrollLeft = field.scrollLeft;
  };

  return (
    <div className={cx("relative overflow-hidden rounded-lg border border-line-strong bg-page", className)}>
      <pre
        ref={backdropRef}
        aria-hidden
        className="hljs-md pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-fg"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        {...rest}
        ref={fieldRef}
        value={value}
        rows={rows}
        aria-label={ariaLabel}
        spellCheck={spellCheck}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        className={cx(
          "relative z-10 block w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent",
          "p-3 font-mono text-[11px] leading-relaxed text-transparent caret-fg outline-none",
          "placeholder:text-fg-faint",
        )}
      />
    </div>
  );
}
