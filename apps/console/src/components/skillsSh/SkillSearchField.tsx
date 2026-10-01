"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button, IconButton, Input, useClickOutside } from "@/ui/UIKit";

export interface ShSkill {
  id: string;
  name: string;
  source: string;
  installs?: number;
  url?: string;
}

/**
 * Поиск по реестру skills.sh с автодополнением: ввод с дебаунсом 300 мс,
 * выпадающий список находок (кнопка установки + внешняя ссылка) и строка
 * "установить как пакет". Общий примитив InstallSkillModal и SkillsShSearch.
 */
export function SkillSearchField({
  autoFocus,
  placeholder = "найти навык (например: pdf, browser) или введите owner/repo…",
  installLabel = "Установить",
  onPick,
  onInstallPackage,
}: {
  autoFocus?: boolean;
  placeholder?: string;
  installLabel?: string;
  /** Выбор конкретного навыка из списка (открытие карточки/деталей). */
  onPick: (skill: ShSkill) => void;
  /** Установка строки запроса как пакета owner/repo. */
  onInstallPackage: (pkg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ShSkill[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useClickOutside(() => setOpen(false));

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setItems([]);
      setHint(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/skills-sh/search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const data = (await res.json()) as { items?: ShSkill[]; hint?: string | null };
      setItems(data.items ?? []);
      setHint(data.hint ?? null);
      setOpen(true);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div ref={boxRef} className="relative">
      <Input
        size="lg"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full"
      />
      {open && (items.length > 0 || hint) ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface shadow-xl">
          {hint && items.length === 0 ? <p className="px-3 py-2 text-xs text-fg-faint">{hint}</p> : null}
          {items.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-0 hover:bg-raised/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-fg">{skill.name}</p>
                <p className="truncate font-mono text-[10px] text-fg-faint">
                  {skill.source}
                  {skill.installs !== undefined ? ` · ${skill.installs} установок` : ""}
                </p>
              </div>
              {skill.url ? (
                <IconButton
                  icon={ExternalLink}
                  label={`Открыть страницу навыка: ${skill.url}`}
                  href={skill.url}
                  size="xs"
                />
              ) : null}
              <Button variant="primary" size="sm" onClick={() => onPick(skill)}>
                {installLabel}
              </Button>
            </div>
          ))}
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => onInstallPackage(query.trim())}
              className="w-full px-3 py-2 text-left text-[11px] text-fg-faint hover:bg-raised/60"
            >
              установить как пакет: <span className="font-mono text-fg-muted">{query.trim()}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
