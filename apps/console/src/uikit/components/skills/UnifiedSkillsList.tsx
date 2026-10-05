"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { confirmDialog, IconButton } from "@/uikit";
import { Chip, EmptyState, Loading, Panel, Toggle } from "@/uikit";
import { LifecycleInfoModal, skillLifecycleInfo } from "@/uikit/components/common/LifecycleInfoModal";

/**
 * Единый список навыков: все лейблы (internal/runtime/skills.sh/plugin/workflow)
 * одной лентой с сегментированными фильтрами. У каждого навыка - лейбл-чип,
 * бейджи рантаймов (выключенный - неактивный), источник и тоггл (у workflow
 * тоггла нет - управление через workflow). Режим settings переключает значение
 * по умолчанию; режим runtime - override данного рантайма (со сбросом).
 * Переключение выполняет хуки включения/выключения (симлинки в обязательной
 * папке + команды манифеста) - ошибки хуков показываются под строкой.
 */

export type SkillLabel = "internal" | "design" | "runtime" | "skills.sh" | "plugin" | "workflow";

interface UnifiedSkillDTO {
  key: string;
  name: string;
  label: SkillLabel;
  description: string;
  source: string;
  tags: string[];
  toggleable: boolean;
  itemId: string;
  defaultEnabled: boolean;
  runtimes: Array<{ runtime: string; installed: boolean; effective: boolean }>;
  workflowId?: string;
  manifestHooks?: { install: string[]; remove: string[]; enable: string[]; disable: string[] };
}

interface SkillsAllDTO {
  useGlobal: boolean;
  mandatoryWorkspace: string;
  items: UnifiedSkillDTO[];
}

const LABEL_TONE: Record<SkillLabel, "sky" | "emerald" | "neutral" | "amber" | "dashed"> = {
  internal: "sky",
  design: "amber",
  runtime: "emerald",
  "skills.sh": "neutral",
  plugin: "amber",
  workflow: "dashed",
};

const FILTERS: Record<"settings" | "runtime", Array<{ key: SkillLabel | "all"; label: string }>> = {
  // Настройки: репозиториевые и workflow-навыки; runtime-глобальные показываются только в пространстве рантайма.
  settings: [
    { key: "all", label: "Все" },
    { key: "internal", label: "internal" },
    { key: "design", label: "design" },
    { key: "skills.sh", label: "skills.sh" },
    { key: "plugin", label: "plugin" },
    { key: "workflow", label: "workflow" },
  ],
  // Пространство рантайма: только навыки, доступные этому рантайму; workflow не привязан к рантайму.
  runtime: [
    { key: "all", label: "Все" },
    { key: "internal", label: "internal" },
    { key: "design", label: "design" },
    { key: "runtime", label: "runtime" },
    { key: "skills.sh", label: "skills.sh" },
    { key: "plugin", label: "plugin" },
  ],
};

export function UnifiedSkillsList({ mode, runtimeId }: { mode: "settings" | "runtime"; runtimeId?: string }) {
  const [data, setData] = useState<SkillsAllDTO | null>(null);
  const [filter, setFilter] = useState<SkillLabel | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, string[]>>({});
  const [infoOpen, setInfoOpen] = useState<UnifiedSkillDTO | null>(null);

  const load = useCallback(() => {
    void fetch("/api/skills/all", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: SkillsAllDTO) => setData(j))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => {
    const scoped = (data?.items ?? []).filter((item) => {
      if (mode === "settings") return item.label !== "runtime";
      return Boolean(runtimeId && item.runtimes.some((entry) => entry.runtime === runtimeId && entry.installed));
    });
    return scoped.filter((item) => filter === "all" || item.label === filter);
  }, [data, filter, mode, runtimeId]);
  const counts = useMemo(() => {
    const scoped = (data?.items ?? []).filter((item) => {
      if (mode === "settings") return item.label !== "runtime";
      return Boolean(runtimeId && item.runtimes.some((entry) => entry.runtime === runtimeId && entry.installed));
    });
    const map = new Map<SkillLabel | "all", number>([["all", scoped.length]]);
    for (const item of scoped) map.set(item.label, (map.get(item.label) ?? 0) + 1);
    return map;
  }, [data, mode, runtimeId]);

  const applyPatch = async (body: Record<string, unknown>, item: UnifiedSkillDTO): Promise<boolean> => {
    setBusy(item.key);
    setNotices((old) => {
      const next = { ...old };
      delete next[item.key];
      return next;
    });
    try {
      const res = await fetch("/api/skills", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { hookErrors?: string[]; error?: string };
      if (!res.ok) {
        setNotices((old) => ({ ...old, [item.key]: [json.error ?? "переключение не выполнено"] }));
        return false;
      }
      if (json.hookErrors?.length) setNotices((old) => ({ ...old, [item.key]: json.hookErrors! }));
      load();
      return true;
    } catch {
      setNotices((old) => ({ ...old, [item.key]: ["сеть недоступна - переключение не выполнено"] }));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onToggle = (item: UnifiedSkillDTO, next: boolean) => {
    if (mode === "runtime" && runtimeId) {
      void applyPatch({ level: "runtime", itemId: item.itemId, runtime: runtimeId, enabled: next }, item);
    } else {
      void applyPatch({ level: "default", itemId: item.itemId, enabled: next }, item);
    }
  };

  const onReset = (item: UnifiedSkillDTO) => {
    if (!data) return;
    void applyPatch({ level: "runtime", itemId: item.itemId, runtime: runtimeId, enabled: data.useGlobal }, item);
  };

  const onRemove = async (item: UnifiedSkillDTO) => {
    const ok = await confirmDialog({
      title: `Удалить навык ${item.name}?`,
      message: `Перед удалением выполнится hook remove (если объявлен). Будут удалены: .agents/skills/${item.name}, запись skills-lock.json, симлинки в каталогах агентов (.claude, .cursor, .codex, .opencode, .zcode) и симлинки включения в обязательной рабочей папке. Роли с этим навыком в skills потеряют его. Действие необратимо - вернуть можно повторной установкой.`,
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(item.key);
    try {
      await fetch("/api/skills/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: item.name }) });
      load();
    } catch {
      /* сеть недоступна - список останется прежним */
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Loading>загрузка навыков…</Loading>;

  return (
    <Panel title={mode === "runtime" ? "Навыки" : "Навыки (все источники)"} actions={
      <div className="flex flex-wrap gap-1" role="group" aria-label="фильтр по лейблу">
        {FILTERS[mode].map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${filter === entry.key ? "border-info bg-info/10 text-info" : "border-line text-fg-faint hover:text-fg"}`}
          >
            {entry.label} <span className="opacity-60">{counts.get(entry.key) ?? 0}</span>
          </button>
        ))}
      </div>
    }>
      {items.length === 0 ? (
        <EmptyState size="sm">навыков с таким лейблом нет</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const runtimeState = runtimeId ? item.runtimes.find((entry) => entry.runtime === runtimeId) : undefined;
            const checked = mode === "runtime" && runtimeId ? runtimeState?.effective ?? false : item.defaultEnabled;
            return (
              <li key={item.key} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm">{item.name}</span>
                    <Chip tone={LABEL_TONE[item.label]} mono>{item.label}</Chip>
                    {item.label === "workflow" && item.workflowId ? (
                      <a className="text-[11px] text-info underline" href={`/agent?tab=workflow`}>открыть</a>
                    ) : null}
                    <span className="flex flex-wrap gap-1" aria-label="рантаймы">
                      {item.runtimes.filter((entry) => entry.installed).map((entry) => (
                        <Chip key={entry.runtime} tone={entry.effective ? "solid" : "dim"} title={entry.effective ? `${entry.runtime}: активен` : `${entry.runtime}: выключен`}>
                          {entry.runtime}
                        </Chip>
                      ))}
                    </span>
                  </div>
                  {item.description ? <p className="mt-0.5 line-clamp-2 text-xs text-fg-faint">{item.description}</p> : null}
                  <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">{item.source}</p>
                  {item.manifestHooks && Object.values(item.manifestHooks).some((list) => list.length) ? (
                    <p className="mt-0.5 text-[10px] text-fg-faint">
                      хуки: {(["install", "remove", "enable", "disable"] as const).filter((op) => item.manifestHooks![op].length).join(", ")}
                    </p>
                  ) : null}
                  {notices[item.key]?.length ? (
                    <p className="mt-1 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">{notices[item.key].join("; ")}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton
                    icon={Info}
                    label={`жизненный цикл: ${item.name}`}
                    variant="ghost"
                    size="xs"
                    onClick={() => setInfoOpen(item)}
                  />
                  {item.toggleable ? (
                    <>
                      {mode === "runtime" && runtimeId ? (
                        <button type="button" className="text-[11px] text-fg-faint underline hover:text-fg" onClick={() => onReset(item)}>
                          сброс
                        </button>
                      ) : null}
                      <Toggle checked={checked} disabled={busy === item.key} onChange={(next) => onToggle(item, next)} ariaLabel={`${item.name}: ${checked ? "включён" : "выключен"}`} />
                    </>
                  ) : (
                    <span className="text-[10px] text-fg-faint">без тоггла</span>
                  )}
                  {item.label === "skills.sh" ? (
                    <button type="button" className="text-[11px] text-danger underline" disabled={busy === item.key} onClick={() => void onRemove(item)}>
                      удалить
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <LifecycleInfoModal
        open={infoOpen !== null}
        onClose={() => setInfoOpen(null)}
        info={infoOpen ? skillLifecycleInfo({ label: infoOpen.label, name: infoOpen.name, manifestHooks: infoOpen.manifestHooks }) : skillLifecycleInfo({ label: "internal", name: "" })}
      />
    </Panel>
  );
}
