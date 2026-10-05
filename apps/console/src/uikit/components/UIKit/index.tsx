"use client";

/**
 * UIKit консоли - единственный источник примитивов интерфейса.
 *
 * Правила:
 * - доменные компоненты (StatusBadge, RuntimeCard, панели вкладок…) собираются
 *   из этих примитивов; стайлить кнопки/поля/чипы вручную больше не нужно;
 * - нативные браузерные контролы не используются: выпадающие списки рисует
 *   Select (нативный <select> запрещён), подтверждения - confirmDialog
 *   вместо window.confirm (хост <UIKitHost /> монтируется в layout).
 */

import Link from "next/link";
import { Check, ChevronDown, X, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEventHandler,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { normalizeHex } from "@/lib/themes";

/* ------------------------------- утилиты ------------------------------- */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Ref-хук: вызывает колбэк по mousedown вне элемента (закрытие попапов). */
export function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cbRef.current();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return ref;
}

/* -------------------------------- Button -------------------------------- */

export type ButtonVariant = "primary" | "accent" | "warning" | "danger" | "ghost" | "ghostDim" | "neutral";
export type ButtonSize = "xs" | "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-accent/40 bg-accent/10 text-accent",
  accent: "border-info/40 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  ghost: "border-line-strong text-fg-muted hover:bg-raised",
  ghostDim: "border-line-strong text-fg-muted hover:bg-raised hover:text-fg",
  neutral: "border-line-strong text-fg hover:bg-raised",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-[11px]",
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-xs",
};

export function Button({
  variant = "ghost",
  size = "sm",
  className,
  type = "button",
  href,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Ссылка вместо кнопки: рендерится anchor с теми же стилями. */
  href?: string;
}) {
  const cls = cx(
    "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-40",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
  if (href) {
    return <a href={href} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} className={cls} />;
  }
  return (
    <button
      type={type}
      {...rest}
      className={cls}
    />
  );
}

/* ------------------------------ IconButton ------------------------------ */

/** Квадратные габариты icon-only кнопок (иконка центрируется). */
const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "h-6 w-6",
  sm: "h-7 w-7",
  md: "h-8 w-8",
};

const ICON_SIZES: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 16 };

/**
 * Кнопка-иконка (lucide-react): квадратная, без текста. label обязателен -
 * идёт в title и aria-label (иконные кнопки должны иметь текстовое имя).
 * С href рендерится <a target="_blank"> с теми же классами (внешние ссылки);
 * остальные props применимы только к кнопочному варианту.
 */
export function IconButton({
  icon: Icon,
  label,
  variant = "ghostDim",
  size = "sm",
  href,
  className,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
  icon: LucideIcon;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
  className?: string;
}) {
  const cls = cx(
    "inline-flex shrink-0 items-center justify-center rounded-lg border transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-40",
    BUTTON_VARIANTS[variant],
    ICON_BUTTON_SIZES[size],
    className,
  );
  const icon = <Icon size={ICON_SIZES[size]} aria-hidden />;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={label} aria-label={label} className={cls}>
        {icon}
      </a>
    );
  }
  return (
    <button type={type} title={label} aria-label={label} {...rest} className={cls}>
      {icon}
    </button>
  );
}

/* -------------------------------- Toggle -------------------------------- */

export function Toggle({
  checked,
  onChange,
  disabled,
  size = "sm",
  title,
  ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const dims =
    size === "md"
      ? { track: "h-6 w-11", knob: "h-[1.1rem] w-[1.1rem]", on: "left-[22px]", off: "left-0.5" }
      : { track: "h-5 w-9", knob: "h-3.5 w-3.5", on: "left-[18px]", off: "left-0.5" };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative shrink-0 rounded-full border transition-colors",
        dims.track,
        checked ? "border-accent/50 bg-accent/30" : "border-line-strong bg-raised",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 rounded-full transition-all",
          dims.knob,
          checked ? cx(dims.on, "bg-accent") : cx(dims.off, "bg-line-strong"),
        )}
      />
    </button>
  );
}

/* -------------------------------- RadioRow -------------------------------- */

/** Строка radio-выбора (подписки, тарифы): круг-индикатор, заголовок, описание и значение справа. */
export function RadioRow({
  name,
  checked,
  onChange,
  title,
  description,
  trailing,
  disabled,
}: {
  /** Имя radio-группы (нативный input). */
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description?: string;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
        checked ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-raised/60",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
      <span className={cx("grid size-3.5 shrink-0 place-items-center rounded-full border", checked ? "border-accent" : "border-line-strong")}>
        {checked ? <span className="size-1.5 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-fg">{title}</span>
        {description ? <span className="block truncate text-[11px] text-fg-faint">{description}</span> : null}
      </span>
      {trailing}
    </label>
  );
}

/* -------------------------------- Select -------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  /** Группа в выпадающем списке: опции с одинаковой группой идут под одним заголовком. */
  group?: string;
}

const SELECT_SIZES = {
  sm: "rounded-lg bg-surface px-2 py-1 text-xs",
  md: "rounded bg-page px-2 py-1.5 text-xs",
} as const;

/** Опции, разбитые на группы по первому появлению; опции без группы - в начало без заголовка. */
function groupOptions(options: SelectOption[]): { group: string | null; options: { option: SelectOption; index: number }[] }[] {
  const order: (string | null)[] = [];
  const byGroup = new Map<string | null, { option: SelectOption; index: number }[]>();
  options.forEach((option, index) => {
    const key = option.group ?? null;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push({ option, index });
  });
  return order.map((group) => ({ group, options: byGroup.get(group)! }));
}

/**
 * Выпадающий список без нативного <select>: кнопка-триггер + попап-listbox.
 * Клавиатура: ArrowUp/Down/Home/End - навигация, Enter - выбор, Esc - закрыть.
 */
export function Select({
  value,
  options,
  onChange,
  size = "sm",
  disabled,
  className,
  ariaLabel,
  id,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  size?: keyof typeof SELECT_SIZES;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useClickOutside(() => setOpen(false));
  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIdx];
  const grouped = open ? groupOptions(options) : [];

  const commit = (option: SelectOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) setHighlight(selectedIdx);
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setHighlight(selectedIdx);
              setOpen(true);
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Home") {
            e.preventDefault();
            setHighlight(0);
          } else if (e.key === "End") {
            e.preventDefault();
            setHighlight(options.length - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (options[highlight]) commit(options[highlight]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className={cx(
          "flex w-full items-center justify-between gap-1.5 border border-line-strong text-fg",
          SELECT_SIZES[size],
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown size={12} aria-hidden className="shrink-0 text-fg-faint" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface shadow-xl"
        >
          {grouped.map(({ group, options: groupOptions2 }) => (
            <li key={group ?? "__ungrouped__"} role="presentation">
              {group ? (
                <p className="sticky top-0 bg-surface px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                  {group}
                </p>
              ) : null}
              {groupOptions2.map(({ option, index }) => (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  aria-posinset={index + 1}
                  aria-setsize={options.length}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => commit(option)}
                  className={cx(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                    index === highlight ? "bg-raised/60 text-fg" : "text-fg-muted",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.value === value ? (
                    <Check size={12} aria-hidden className="shrink-0 text-accent" />
                  ) : null}
                </div>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* --------------------------------- Modal --------------------------------- */

/**
 * Оверлей-модалка: шапка с заголовком и кнопкой "Закрыть", слот description,
 * контент и опциональный футер (кнопки справа). Закрытие - Esc и кнопка;
 * клик по оверлею формы не теряет (политически безопаснее).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-2xl",
  scroll = true,
  closable = true,
  fullscreen = false,
  headerActions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  scroll?: boolean;
  closable?: boolean;
  /** Панель почти во весь экран (по ширине и высоте). */
  fullscreen?: boolean;
  /** Круглые кнопки-действия в шапке, слева от крестика закрытия. */
  headerActions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div
        className={cx(
          "flex w-full flex-col rounded-xl border border-line-strong bg-surface p-5",
          fullscreen ? "h-[94vh] max-h-[94vh] max-w-[96vw]" : "max-h-[85vh]",
          !fullscreen && width,
          scroll && "overflow-y-auto",
        )}
      >
        <div className={cx("flex items-center justify-between gap-3", description ? "mb-1" : "mb-3")}>
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {closable ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {headerActions}
              <IconButton
                icon={X}
                label="Закрыть"
                variant="ghostDim"
                onClick={onClose}
                className="rounded-full"
                aria-label="Закрыть"
              />
            </div>
          ) : null}
        </div>
        {description ? <p className="mb-4 text-[11px] leading-relaxed text-fg-faint">{description}</p> : null}
        {children}
        {footer ? <div className="mt-4 flex shrink-0 justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------- Notice -------------------------------- */

export function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: "info" | "success" | "error";
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-line-strong bg-page/60 text-fg-muted",
    success: "border-accent/40 bg-accent/5 text-accent",
    error: "border-danger/40 bg-danger/5 text-danger",
  } as const;
  return (
    <div className={cx("rounded-lg border px-3 py-2 text-[11px] leading-relaxed", tones[tone], className)}>
      {children}
    </div>
  );
}

/* --------------------------------- Panel --------------------------------- */

/**
 * Карточка-секция: скруглённая рамка на тёмном фоне с опциональной шапкой
 * (заголовок слева, actions справа).
 */
export function Panel({
  as = "section",
  title,
  titleClassName,
  actions,
  children,
  className,
}: {
  as?: "section" | "article" | "div";
  title?: ReactNode;
  titleClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag className={cx("rounded-xl border border-line bg-surface/60 p-4", className)}>
      {title !== undefined || actions !== undefined ? (
        <div className={cx("flex flex-wrap items-center gap-2", children !== undefined && "mb-3")}>
          {title !== undefined ? (
            <h2 className={cx("text-sm font-semibold text-fg", titleClassName)}>{title}</h2>
          ) : null}
          {actions !== undefined ? (
            <div className={cx("flex flex-wrap items-center gap-2", title !== undefined && "ml-auto")}>{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/* ---------------------------------- Tabs --------------------------------- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  size = "md",
  className,
}: {
  tabs: readonly { key: T; label: string; badge?: number | string }[];
  active: T;
  onChange: (key: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="tablist" className={cx("flex flex-wrap items-center gap-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          onClick={() => onChange(tab.key)}
          className={cx(
            "rounded-lg transition-colors",
            size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
            tab.key === active ? "bg-raised text-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge !== "" ? (
            <span className="ml-1 text-[11px] text-warning">· {tab.badge}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Сегментный переключатель (слитные кнопки в общей рамке). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: readonly { key: T; label: string; count?: number; countTone?: "neutral" | "danger" }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx("flex max-w-full overflow-x-auto rounded-lg border border-line-strong", className)}
    >
      {options.map((option) => {
        const count = option.count ?? 0;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
            className={cx(
              "flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-1 text-xs transition-colors",
              value === option.key
                ? "bg-raised text-fg"
                : "bg-surface text-fg-muted hover:bg-raised hover:text-fg",
            )}
          >
            {option.label}
            {count > 0 ? (
              <span
                className={cx(
                  "flex h-4 min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium leading-none tabular-nums",
                  option.countTone === "danger" ? "bg-danger/15 text-danger" : "bg-line/50 text-fg-muted",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- Chip --------------------------------- */

export type ChipTone = "neutral" | "solid" | "muted" | "dim" | "dashed" | "emerald" | "amber" | "red" | "sky";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "border-line-strong bg-raised/50 text-fg-muted",
  solid: "bg-raised text-fg-muted",
  muted: "border-line-strong text-fg-faint",
  dim: "border-line-strong bg-surface text-fg-faint",
  dashed: "border-dashed border-line-strong text-fg-faint",
  emerald: "border-accent/30 bg-accent/10 text-accent",
  amber: "border-warning/40 bg-warning/10 text-warning",
  red: "border-danger/40 bg-danger/10 text-danger",
  sky: "border-info/40 bg-info/10 text-info",
};

/** Маленький чип-лейбл. С onClick рендерится кнопкой (интерактивные чипы). */
export function Chip({
  tone = "neutral",
  size = "xs",
  mono,
  title,
  onClick,
  className,
  children,
  ...drag
}: {
  tone?: ChipTone;
  size?: "xs" | "sm";
  mono?: boolean;
  title?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  /** HTML5 drag-and-drop: перетаскиваемые чипы (порядок списков в редакторах). */
  draggable?: boolean;
  onDragStart?: DragEventHandler<HTMLElement>;
  onDragOver?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>;
}) {
  const cls = cx(
    "inline-flex shrink-0 items-center rounded border",
    size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
    mono && "font-mono",
    CHIP_TONES[tone],
    (onClick || drag.draggable) && "transition-colors hover:brightness-110",
    className,
  );
  if (onClick) {
    return (
      <button type="button" title={title} onClick={onClick} className={cls} {...drag}>
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={cls} {...drag}>
      {children}
    </span>
  );
}

/* --------------------------------- Inputs -------------------------------- */

const FIELD_BASE = "border border-line-strong bg-page text-xs text-fg placeholder:text-fg-faint";

export function Input({
  size = "compact",
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> & {
  size?: "compact" | "form" | "lg";
  className?: string;
}) {
  return (
    <input
      {...rest}
      className={cx(
        FIELD_BASE,
        size === "compact"
          ? "rounded px-2 py-1.5"
          : size === "form"
            ? "rounded-lg px-3 py-2"
            : "rounded-lg px-3 py-2 text-sm",
        className,
      )}
    />
  );
}

export function Textarea({
  size = "compact",
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
  size?: "compact" | "form";
  className?: string;
  /** React 19: ref проходит через props и попадает на <textarea> через спред. */
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      {...rest}
      className={cx(FIELD_BASE, size === "compact" ? "rounded px-2 py-1.5" : "rounded-lg px-3 py-2", className)}
    />
  );
}

/* ------------------------------ ColorSwatch ------------------------------ */

/**
 * Свотч цвета для редактора токенов: кнопка-цвет, открывающая системный
 * color-picker (нативный input скрыт под кнопкой), рядом hex-поле. В onChange
 * уходит текст поля как есть; нормализованный hex пробрасывается по blur и
 * выбору пикера - невалидное промежуточное значение наружу не отдаётся.
 */
export function ColorSwatch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  const commit = (raw: string) => {
    const hex = normalizeHex(raw);
    if (hex && hex !== value) onChange(hex);
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <label
        className="relative inline-flex h-6 w-9 shrink-0 cursor-pointer overflow-hidden rounded border border-line-strong"
        title={label}
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(event) => commit(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        aria-label={label}
        spellCheck={false}
        className="w-[4.5rem] font-mono text-[11px]"
      />
    </span>
  );
}

/* ------------------------------ текст-примитивы ----------------------------- */

export function Loading({ children = "загрузка…", className }: { children?: ReactNode; className?: string }) {
  return <p className={cx("text-xs text-fg-faint", className)}>{children}</p>;
}

/** Плейсхолдер "пусто" в пунктирной рамке. */
export function EmptyState({
  children,
  size = "md",
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <p
      className={cx(
        "border border-dashed border-line text-fg-faint",
        size === "md" ? "rounded-xl p-6 text-sm" : "rounded-lg p-4 text-xs",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionLabel({
  as = "p",
  className,
  children,
}: {
  as?: "p" | "h3" | "div";
  className?: string;
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag className={cx("text-[11px] font-medium uppercase tracking-wide text-fg-faint", className)}>{children}</Tag>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label className="text-xs text-fg-faint" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function Footnote({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("text-[10px] leading-relaxed text-fg-faint", className)}>{children}</p>;
}

/* --------------------------- layout: страница и навигация --------------------------- */

/**
 * Шапка страницы: заголовок и описание слева, actions справа. children
 * рендерятся внутри левой колонки под описанием (счётчики, строки статуса).
 * Отступ снизу - на вызывающем (Page даёт mb-6, Dashboard - mb-8 через className).
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-col items-end gap-2">{actions}</div> : null}
    </header>
  );
}

/** Layout-обёртка типовой страницы: <main> + шапка (mb-6) + контент. */
export function Page({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={className}>
      <PageHeader title={title} description={description} actions={actions} className="mb-6" />
      {children}
    </main>
  );
}

/**
 * Горизонтальная навигация из ссылок: активная подсвечивается и получает
 * aria-current="page". Правило "какой путь сейчас активен" - на вызывающем
 * через isActive, UIKit остаётся домен-свободным. right - слот справа
 * (бренд-строка, часы и т.п.).
 */
export function NavBar({
  items,
  isActive,
  right,
  ariaLabel = "Основная навигация",
  className,
}: {
  items: readonly { href: string; label: string }[];
  isActive: (href: string) => boolean;
  right?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cx("mb-8 flex flex-wrap items-center gap-1 border-b border-line/60 pb-3", className)}
    >
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              active ? "bg-raised text-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {right ? <span className="ml-auto">{right}</span> : null}
    </nav>
  );
}

/* --------------------- подтверждения вместо window.confirm --------------------- */

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let confirmListeners: Array<(req: ConfirmRequest | null) => void> = [];
let currentConfirm: ConfirmRequest | null = null;

/**
 * Асинхронное подтверждение вместо нативного confirm(): рендерится хостом
 * <UIKitHost />. Пример: if (!(await confirmDialog({ title: "Удалить?" }))) return;
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (currentConfirm) currentConfirm.resolve(false);
  return new Promise((resolve) => {
    currentConfirm = { ...options, resolve };
    for (const listener of confirmListeners) listener(currentConfirm);
  });
}

/** Хост диалогов подтверждения; монтируется один раз в layout. */
export function UIKitHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  useEffect(() => {
    const listener = (req: ConfirmRequest | null) => setRequest(req);
    confirmListeners.push(listener);
    return () => {
      confirmListeners = confirmListeners.filter((l) => l !== listener);
    };
  }, []);

  if (!request) return null;
  const done = (ok: boolean) => {
    request.resolve(ok);
    if (currentConfirm === request) currentConfirm = null;
    setRequest(null);
  };
  return (
    <Modal
      open
      onClose={() => done(false)}
      title={request.title}
      width="max-w-md"
      scroll={false}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => done(false)}>
            {request.cancelLabel ?? "Отмена"}
          </Button>
          <Button variant={request.tone === "danger" ? "danger" : "primary"} size="md" onClick={() => done(true)}>
            {request.confirmLabel ?? "OK"}
          </Button>
        </>
      }
    >
      {request.message ? <p className="whitespace-pre-line text-xs leading-relaxed text-fg-muted">{request.message}</p> : null}
    </Modal>
  );
}
