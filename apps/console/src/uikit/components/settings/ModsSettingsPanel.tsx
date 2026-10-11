"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Button, Chip, confirmDialog, IconButton, Loading, Notice, Panel, Tabs, Toggle } from "@/uikit";
import { LifecycleInfoModal, modLifecycleInfo } from "@/uikit/components/common/LifecycleInfoModal";

interface ModItem {
  id: string;
  displayName: string;
  description: string;
  url: string;
  marketplace: { kind: "github"; source: string; name: string } | { kind: "clone"; repo: string; subPath: string; name: string };
  plugin: string;
  requires?: string;
  prerequisite?: { label: string; command: string };
  notes?: string;
  installed: boolean;
  enabled: boolean;
}

interface ModsData {
  cliAvailable: boolean;
  reconciled: boolean;
  reconcileError?: string;
  mods: ModItem[];
}

type ModSubTab = "claude";

const SUB_TABS: readonly { key: ModSubTab; label: string }[] = [{ key: "claude", label: "Claude" }];

/** Вкладка "Моды" (Настройки): каталог модов Claude Code, установка через CLI claude plugin. */
export function ModsSettingsPanel() {
  const [subTab, setSubTab] = useState<ModSubTab>("claude");
  const [data, setData] = useState<ModsData | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [infoMod, setInfoMod] = useState<ModItem | null>(null);

  const load = useCallback(async (reconcile: boolean) => {
    const res = await fetch(`/api/mods${reconcile ? "?reconcile=1" : ""}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as ModsData);
  }, []);

  useEffect(() => {
    // быстрая отрисовка из зеркала состояния, затем сверка статусов с CLI
    void load(false).then(() => load(true));
  }, [load]);

  const act = async (id: string, fn: () => Promise<Response>, okText: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fn();
      const result = (await res.json()) as { error?: string; output?: string };
      setNotice({ ok: res.ok, text: res.ok ? okText : [result.error ?? "ошибка", result.output].filter(Boolean).join(": ") });
      await load(true);
    } finally {
      setBusyId(null);
    }
  };

  const install = (mod: ModItem) =>
    act(
      mod.id,
      () =>
        fetch("/api/mods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: mod.id }),
        }),
      `мод ${mod.displayName} установлен и включён (загрузится в новых сессиях Claude Code)`,
    );

  const toggle = (mod: ModItem) =>
    act(
      mod.id,
      () =>
        fetch("/api/mods", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: mod.id, enabled: !mod.enabled }),
        }),
      `мод ${mod.displayName}: ${mod.enabled ? "выключен" : "включён"}`,
    );

  const uninstall = async (mod: ModItem) => {
    if (
      !(await confirmDialog({
        title: `Удалить мод "${mod.displayName}"?`,
        message: `Выполнится claude plugin uninstall ${mod.plugin}. Marketplace остаётся добавленным; мод возвращается повторной установкой. Действие необратимо.`,
        confirmLabel: "Удалить",
        tone: "danger",
      }))
    ) {
      return;
    }
    await act(mod.id, () => fetch(`/api/mods?id=${encodeURIComponent(mod.id)}`, { method: "DELETE" }), `мод ${mod.displayName} удалён`);
  };

  const requestInstall = async (mod: ModItem) => {
    const ok = await confirmDialog({
      title: `Установить мод "${mod.displayName}"?`,
      message: [
        `Выполнятся команды claude plugin marketplace add и claude plugin install ${mod.plugin} --scope user. Мод включится в новых сессиях Claude Code.`,
        ...(mod.prerequisite ? [`Предварительно требуется ${mod.prerequisite.label}: ${mod.prerequisite.command}`] : []),
        ...(mod.requires ? [`Требуется Claude Code ${mod.requires}.`] : []),
      ].join("\n"),
      confirmLabel: "Установить",
    });
    if (ok) void install(mod);
  };

  const cliOk = data?.cliAvailable ?? true;

  return (
    <>
      {notice ? <Notice tone={notice.ok ? "success" : "error"} className="mb-4">{notice.text}</Notice> : null}
      {data && !data.cliAvailable ? (
        <Notice tone="info" className="mb-4">
          CLI claude не найден в PATH - установка, переключение и удаление модов недоступны. Установите Claude Code и перезапустите консоль.
        </Notice>
      ) : null}
      {data?.reconcileError ? <Notice tone="info" className="mb-4">Сверка статусов с CLI не выполнена: {data.reconcileError}. Показаны значения из зеркала состояния.</Notice> : null}

      <Tabs tabs={SUB_TABS} active={subTab} onChange={setSubTab} size="sm" className="mb-4" />

      {subTab === "claude" ? (
        <Panel
          title="Моды Claude Code"
          actions={
            <Button variant="ghostDim" size="xs" disabled={busyId !== null} onClick={() => void load(true)}>
              Обновить
            </Button>
          }
        >
          <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
            Мод - плагин Claude Code с hooks-модулем (собственный UI над промптом, перехват действий) или обычный
            community-плагин. Установка идёт через официальный marketplace-механизм: консоль выполняет команды{" "}
            <span className="font-mono">claude plugin marketplace add</span> и{" "}
            <span className="font-mono">claude plugin install</span>; статусы сверяются командой{" "}
            <span className="font-mono">claude plugin list</span>. Hooks-моды требуют Claude Code 2.1.287+.
          </p>
          {!data ? (
            <Loading />
          ) : (
            <ul className="divide-y divide-line/50">
              {data.mods.map((mod) => (
                <li key={mod.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-fg">
                      {mod.displayName}
                      <Chip tone="dim">{mod.plugin}</Chip>
                      {mod.requires ? <Chip tone="dashed">CC {mod.requires}</Chip> : null}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">{mod.description}</p>
                    {mod.prerequisite ? (
                      <p className="mt-0.5 text-[11px] text-warning">
                        требуется {mod.prerequisite.label}: <span className="font-mono">{mod.prerequisite.command}</span>
                      </p>
                    ) : null}
                    <a
                      href={mod.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-mono text-[10px] text-info underline decoration-dotted"
                    >
                      {mod.url}
                    </a>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <IconButton
                      icon={Info}
                      label={`жизненный цикл: ${mod.displayName}`}
                      variant="ghost"
                      size="xs"
                      onClick={() => setInfoMod(mod)}
                    />
                    {mod.installed ? (
                      <>
                        <Toggle
                          checked={mod.enabled}
                          disabled={busyId === mod.id || !cliOk}
                          onChange={() => void toggle(mod)}
                          title={mod.enabled ? "Выключить: мод не загружается в новых сессиях" : "Включить: мод загружается в новых сессиях"}
                          ariaLabel={`мод ${mod.displayName}`}
                        />
                        <Button variant="danger" size="xs" disabled={busyId === mod.id || !cliOk} onClick={() => void uninstall(mod)}>
                          удалить
                        </Button>
                      </>
                    ) : (
                      <Button variant="primary" size="sm" disabled={busyId === mod.id || !cliOk} onClick={() => void requestInstall(mod)}>
                        Установить
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <LifecycleInfoModal
        open={infoMod !== null}
        onClose={() => setInfoMod(null)}
        info={
          infoMod
            ? modLifecycleInfo({
                displayName: infoMod.displayName,
                plugin: infoMod.plugin,
                marketplace: infoMod.marketplace,
                requires: infoMod.requires,
                prerequisite: infoMod.prerequisite,
                notes: infoMod.notes,
              })
            : { domain: "", name: "", install: { steps: [], affected: [], hooks: [] }, enable: { steps: [], affected: [], hooks: [] }, disable: { steps: [], affected: [], hooks: [] }, remove: { steps: [], affected: [], hooks: [] } }
        }
      />
    </>
  );
}
