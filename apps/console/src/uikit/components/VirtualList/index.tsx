"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * Виртуализированный список: в DOM держатся только видимые строки плюс
 * overscan. Высота строки фиксированная (itemHeight) - окно видимости
 * вычисляется из scrollTop без измерений. Строка получает абсолютное
 * позиционирование и высоту itemHeight от компонента.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  height,
  keyOf,
  overscan = 6,
  renderRow,
  ariaLabel,
  empty,
}: {
  items: T[];
  /** Высота одной строки, px (строки однородные). */
  itemHeight: number;
  /** Высота области прокрутки, px. */
  height: number;
  keyOf: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  /** Строк, отрисованных за границей видимости сверху и снизу. */
  overscan?: number;
  ariaLabel?: string;
  empty?: ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef<number | null>(null);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    // перерисовка окна не чаще кадра
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setScrollTop(top);
    });
  }, []);

  if (items.length === 0 && empty !== undefined) return <>{empty}</>;

  const first = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visible = Math.ceil(height / itemHeight) + overscan * 2;
  const last = Math.min(items.length, first + visible);
  const window_ = items.slice(first, last);

  return (
    <div
      role="list"
      aria-label={ariaLabel}
      onScroll={onScroll}
      className="overflow-y-auto overscroll-contain"
      style={{ height }}
    >
      <div className="relative" style={{ height: items.length * itemHeight }}>
        {window_.map((item, index) => (
          <div
            role="listitem"
            key={keyOf(item, first + index)}
            className="absolute left-0 right-0"
            style={{ top: (first + index) * itemHeight, height: itemHeight }}
          >
            {renderRow(item, first + index)}
          </div>
        ))}
      </div>
    </div>
  );
}
