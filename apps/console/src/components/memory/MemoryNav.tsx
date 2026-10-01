"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { NavNode } from "@/core/memory";
import { cx } from "@/ui/UIKit";

/** Группа навигации: заголовок с линией на всю ширину + дерево файлов/заметка. */
export interface NavGroup {
  key: string;
  label: string;
  /** Вторая строка под заголовком (путь, пояснение). */
  hint?: string;
  /** Элементы справа от заголовка (чипы статуса, кнопки). */
  actions?: ReactNode;
  /** Контент вместо дерева: заметка пустой группы, хвост лога сборки. */
  note?: ReactNode;
  nodes: NavNode[];
}

interface NavContext {
  selected: string | null;
  onSelect: (path: string) => void;
  isOpen: (path: string, depth: number) => boolean;
  onToggle: (path: string, open: boolean) => void;
}

function NavNodes({ nodes, depth, ctx }: { nodes: NavNode[]; depth: number; ctx: NavContext }) {
  return (
    <ul className="space-y-px">
      {nodes.map((node) => {
        const indent = { paddingLeft: 6 + depth * 12 };
        if (node.kind === "dir") {
          const open = ctx.isOpen(node.path, depth);
          return (
            <li key={node.path}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => ctx.onToggle(node.path, open)}
                style={indent}
                className="flex w-full items-center gap-1 rounded py-1 pr-1 text-left text-xs text-fg-muted transition-colors hover:bg-raised/60 hover:text-fg"
              >
                <span className="flex w-3 shrink-0 items-center justify-center text-fg-faint">
                  {open ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
                </span>
                <span className="truncate">{node.name}</span>
              </button>
              {open && node.children ? (
                <NavNodes nodes={node.children} depth={depth + 1} ctx={ctx} />
              ) : null}
            </li>
          );
        }
        const active = ctx.selected === node.path;
        return (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => ctx.onSelect(node.path)}
              style={{ paddingLeft: 6 + depth * 12 + 16 }}
              title={node.mtime ? new Date(node.mtime).toLocaleString() : undefined}
              className={cx(
                "block w-full truncate rounded py-1 pr-1 text-left text-xs transition-colors",
                active
                  ? "bg-raised text-fg"
                  : "text-fg-muted hover:bg-raised/60 hover:text-fg",
              )}
            >
              {node.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Навигация по файлам памяти: группы (заголовок + линия вниз на всю ширину),
 * внутри - сворачиваемое дерево (папки верхнего уровня раскрыты по умолчанию).
 */
export function MemoryNav({
  groups,
  selected,
  onSelect,
}: {
  groups: NavGroup[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const ctx: NavContext = {
    selected,
    onSelect,
    isOpen: (path, depth) => overrides.get(path) ?? depth === 0,
    onToggle: (path, open) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(path, !open);
        return next;
      });
    },
  };
  return (
    <nav aria-label="Файлы памяти" className="min-w-0">
      {groups.map((group) => (
        <section key={group.key} className="mb-4 last:mb-0">
          <div className="mb-1.5 flex items-start justify-between gap-2 border-b border-line pb-1.5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                {group.label}
              </p>
              {group.hint ? (
                <p className="truncate font-mono text-[10px] text-fg-faint" title={group.hint}>
                  {group.hint}
                </p>
              ) : null}
            </div>
            {group.actions ? <div className="flex shrink-0 items-center gap-1.5">{group.actions}</div> : null}
          </div>
          {group.note ? <div className="mb-1.5">{group.note}</div> : null}
          {group.nodes.length > 0 ? (
            <NavNodes nodes={group.nodes} depth={0} ctx={ctx} />
          ) : null}
        </section>
      ))}
    </nav>
  );
}

/** Первый попавшийся файл в дереве (обход в порядке отображения). */
export function findFirstFile(nodes: NavNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file") return node.path;
    const nested = node.children ? findFirstFile(node.children) : null;
    if (nested) return nested;
  }
  return null;
}

/** Путь к файлу с точным именем (без учёта регистра) или null. */
export function findFileByName(nodes: NavNode[], name: string): string | null {
  const lower = name.toLowerCase();
  for (const node of nodes) {
    if (node.kind === "file" && node.name.toLowerCase() === lower) return node.path;
    const nested = node.children ? findFileByName(node.children, name) : null;
    if (nested) return nested;
  }
  return null;
}
