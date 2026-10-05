"use client";

import { Check, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { InstallTerminal } from "@/uikit/components/skillsSh/InstallTerminal";
import { PricingStamp } from "@/uikit/components/update/PricingStamp";
import type { ToolJobStepResult } from "@/core/toolJobs";
import type { RegistryItem, UpdateKind, UpdateRegistryDTO } from "@/core/updates";
import { Button, Chip, EmptyState, Loading, Modal, Notice, Panel, cx } from "@/uikit";

/**
 * Вкладка "Настройки → Обновить": реестр зависимостей harness (локальные
 * пакеты workspace и глобальные инструменты) с версиями, статусами последнего
 * обновления и проверкой свежих версий. Проверка открывает модалку выбора
 * устаревших записей; запуск выполняет их команды одним job'ом (терминал -
 * InstallTerminal), итоги подсвечивают строки и пишутся в реестр на сервере.
 */

const KIND_BADGE: Record<UpdateKind, { label: string; tone: "amber" | "sky" | "emerald" | "neutral" | "muted" }> = {
  bun: { label: "bun", tone: "amber" },
  npm: { label: "npm", tone: "sky" },
  uv: { label: "uv", tone: "emerald" },
  brew: { label: "brew", tone: "neutral" },
  system: { label: "система", tone: "muted" },
};

/** "01.10 14:35" (клиентский рендер - данные приходят из fetch). */
function formatStamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusText(item: RegistryItem, exitCode?: number | null): string {
  if (!item.lastUpdateStatus || !item.lastUpdateAt) return item.note ?? "";
  const failed = exitCode !== undefined && exitCode !== null && exitCode !== 0;
  const label = item.lastUpdateStatus === "success" ? "обновлён" : "ошибка";
  return `${label}${failed ? ` (код ${exitCode})` : ""} ${formatStamp(item.lastUpdateAt)}`;
}

/** Строка реестра: статус-иконка, имя, бейдж инструмента, версии. */
function RegistryRow({ item, exitCode }: { item: RegistryItem; exitCode?: number | null }) {
  const badge = KIND_BADGE[item.kind];
  const tone =
    item.lastUpdateStatus === "success"
      ? "border-accent/30 bg-accent/5"
      : item.lastUpdateStatus === "error" || (exitCode !== undefined && exitCode !== null && exitCode !== 0)
        ? "border-danger/30 bg-danger/5"
        : item.updateAvailable
          ? "border-warning/40 bg-warning/5"
          : "border-transparent";
  return (
    <div className={cx("flex items-center gap-2 rounded-lg border px-2.5 py-1.5", tone)}>
      <span className="flex w-4 shrink-0 justify-center">
        {item.lastUpdateStatus === "success" ? (
          <Check size={14} className="text-accent" aria-label="обновлено успешно" />
        ) : item.lastUpdateStatus === "error" ? (
          <X size={14} className="text-danger" aria-label="ошибка обновления" />
        ) : null}
      </span>
      <span className="truncate font-mono text-xs text-fg" title={item.note ?? item.id}>
        {item.name}
      </span>
      <Chip tone={badge.tone} mono>
        {badge.label}
      </Chip>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-muted">
        {item.currentVersion ?? "-"}
        {item.updateAvailable && item.latestVersion ? (
          <span className="text-warning">{" -> "}{item.latestVersion}</span>
        ) : null}
      </span>
      <span className="w-36 shrink-0 text-right text-[10px] text-fg-faint">{statusText(item, exitCode)}</span>
    </div>
  );
}

/** Строка выбора в модалке обновления. */
function SelectRow({ item, checked, onToggle }: { item: RegistryItem; checked: boolean; onToggle: () => void }) {
  const badge = KIND_BADGE[item.kind];
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 hover:bg-raised/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-3.5 shrink-0 accent-accent"
        aria-label={`обновить ${item.name}`}
      />
      <span className="truncate font-mono text-xs text-fg">{item.name}</span>
      <Chip tone={badge.tone} mono>
        {badge.label}
      </Chip>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-muted">
        {item.currentVersion ?? "-"}
        <span className="text-warning">{" -> "}{item.latestVersion}</span>
      </span>
    </label>
  );
}

export function UpdatePanel() {
  const [data, setData] = useState<UpdateRegistryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runCodes, setRunCodes] = useState<Record<string, number | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/update", { cache: "no-store" });
      const json = (await res.json()) as UpdateRegistryDTO & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "реестр обновлений не загружен");
        return;
      }
      setData({ checkedAt: json.checkedAt, local: json.local, global: json.global });
      setError(null);
    } catch {
      setError("сеть недоступна - реестр обновлений не загружен");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const json = (await res.json()) as UpdateRegistryDTO & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "проверка не выполнена");
        return;
      }
      setData({ checkedAt: json.checkedAt, local: json.local, global: json.global });
      const outdated = [...json.local, ...json.global].filter((item) => item.updateAvailable && item.command);
      setRunCodes({});
      setSelected(outdated.map((item) => item.id));
      if (outdated.length > 0) {
        setJobId(null);
        setRunError(null);
        setModalOpen(true);
      }
    } catch {
      setError("сеть недоступна - проверка не выполнена");
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async () => {
    setRunError(null);
    try {
      const res = await fetch("/api/update/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !json.jobId) {
        setRunError(json.error ?? "обновление не запущено");
        return;
      }
      setJobId(json.jobId);
    } catch {
      setRunError("сеть недоступна - обновление не запущено");
    }
  };

  const onJobDoneData = (payload: { exitCode: number | null; results?: ToolJobStepResult[] }) => {
    const codes: Record<string, number | null> = {};
    for (const result of payload.results ?? []) {
      if (result.stepId) codes[result.stepId] = result.exitCode;
    }
    setRunCodes(codes);
    const at = new Date().toISOString();
    setData((prev) => {
      if (!prev) return prev;
      const patch = (items: RegistryItem[]): RegistryItem[] =>
        items.map((item) => {
          if (!(item.id in codes)) return item;
          if (codes[item.id] === 0) {
            return {
              ...item,
              currentVersion: item.latestVersion ?? item.currentVersion,
              updateAvailable: false,
              lastUpdateStatus: "success",
              lastUpdateAt: at,
            };
          }
          return { ...item, lastUpdateStatus: "error", lastUpdateAt: at };
        });
      return { checkedAt: prev.checkedAt, local: patch(prev.local), global: patch(prev.global) };
    });
    // статусы в реестре пишет сервер по завершении job'а - подтягиваем их следом
    setTimeout(() => void load(), 1500);
  };

  const closeModal = () => {
    setModalOpen(false);
    setJobId(null);
    void load();
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const modalItems = data
    ? [...data.local, ...data.global].filter((item) => item.updateAvailable && item.command)
    : [];
  const allCount = data ? data.local.length + data.global.length : 0;
  const outdatedCount = data
    ? [...data.local, ...data.global].filter((item) => item.updateAvailable).length
    : 0;

  return (
    <div className="space-y-3">
      <PricingStamp />
      <Panel
        title="Обновление зависимостей"
        actions={
          <Button variant="primary" onClick={() => void runCheck()} disabled={checking}>
            <RefreshCw size={13} className={cx(checking && "animate-spin")} aria-hidden />
            {checking ? "Проверка…" : "Проверить наличие обновлений"}
          </Button>
        }
      >
        <p className="text-[11px] leading-relaxed text-fg-faint">
          Реестр зависимостей harness: локальные пакеты workspace и глобальные инструменты. Проверка
          опрашивает реестры npm и PyPI, GitHub и brew; запуск обновления выполняет команды выбранных
          записей. Реестр - <span className="font-mono">.agents/console/updates.json</span>.
        </p>
        {data ? (
          <p className="mt-2 text-[11px] text-fg-muted">
            Последняя проверка: {data.checkedAt ? formatStamp(data.checkedAt) : "не выполнялась"} · записей:{" "}
            {allCount} · устаревших: {outdatedCount}
          </p>
        ) : null}
        {error ? (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        ) : null}
      </Panel>

      {!data && !error ? <Loading /> : null}

      {data ? (
        <>
          <Panel title="Локальные пакеты">
            {data.local.length === 0 ? (
              <EmptyState>Пакеты workspace не найдены - выполните bun install в корне репозитория.</EmptyState>
            ) : (
              <div className="space-y-1">
                {data.local.map((item) => (
                  <RegistryRow key={item.id} item={item} exitCode={runCodes[item.id]} />
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Глобальные инструменты">
            {data.global.length === 0 ? (
              <EmptyState>Глобальные инструменты не установлены - раздел "Настройки → Инструменты" или setup.sh.</EmptyState>
            ) : (
              <div className="space-y-1">
                {data.global.map((item) => (
                  <RegistryRow key={item.id} item={item} exitCode={runCodes[item.id]} />
                ))}
              </div>
            )}
          </Panel>
        </>
      ) : null}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={jobId ? "Обновление - выполнение команд" : "Доступные обновления"}
        description={
          jobId
            ? "Команды выполняются по очереди; строки списка подсвечиваются по итогам шагов."
            : "Отметьте записи - будут выполнены их команды обновления. Отмена закрывает окно без запуска."
        }
        footer={
          jobId ? (
            <Button variant="neutral" onClick={closeModal}>
              Готово
            </Button>
          ) : (
            <>
              <Button variant="ghostDim" onClick={closeModal}>
                Отмена
              </Button>
              <Button variant="primary" disabled={selected.length === 0} onClick={() => void runUpdate()}>
                Обновить ({selected.length})
              </Button>
            </>
          )
        }
      >
        {jobId ? (
          <InstallTerminal
            jobId={jobId}
            streamUrl={`/api/tools/job?jobId=${encodeURIComponent(jobId)}`}
            onDoneData={onJobDoneData}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-fg-faint">
                выбрано {selected.length} из {modalItems.length}
              </span>
              <Button
                size="xs"
                variant="ghostDim"
                onClick={() =>
                  setSelected(selected.length === modalItems.length ? [] : modalItems.map((item) => item.id))
                }
              >
                {selected.length === modalItems.length ? "Снять все" : "Выбрать все"}
              </Button>
            </div>
            <div className="space-y-1">
              {modalItems.map((item) => (
                <SelectRow key={item.id} item={item} checked={selected.includes(item.id)} onToggle={() => toggle(item.id)} />
              ))}
            </div>
            {runError ? <Notice tone="error">{runError}</Notice> : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
