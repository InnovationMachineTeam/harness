"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Notice, Page, Panel, RadioRow, Toggle } from "@/uikit";
import { InstallTerminal } from "@/uikit/components/skillsSh/InstallTerminal";

/**
 * Setup Wizard первой установки: шаги "Система" (детект bun/node, установка
 * недостающего), "Пакетный менеджер", "Инструменты" (пакетная установка
 * инструментов экономии контекста), "Готово". Завершение или пропуск снимает
 * gate консоли (POST /api/setup/complete). Установки выполняются job'ами -
 * вывод стримится через InstallTerminal (SSE /api/tools/job).
 */

interface SetupDep {
  id: string;
  title: string;
  purpose: string;
  installed: boolean;
  version: string | null;
  ok: boolean;
  minMajor: number | null;
}

interface SetupTool {
  id: string;
  title: string;
  description: string;
  category: string;
  docsUrl: string | null;
  binInstalled: boolean;
  binVersion: string | null;
  state: "missing" | "on" | "off";
  recommended: boolean;
}

interface SetupStatus {
  required: boolean;
  fresh: boolean;
  wizard: { done: boolean; completedAt: string | null; skippedAt: string | null } | null;
  system: { platform: string; arch: string; hasBrew: boolean; hasApt: boolean; hasPasswordlessSudo: boolean };
  deps: SetupDep[];
  utils: { id: string; installed: boolean }[];
  runtimes: { id: string; title: string; installed: boolean }[];
  packageManager: "bun" | "npm";
  workspaceDepsInstalled: boolean;
  tools: SetupTool[];
}

const STEPS = ["Система", "Пакетный менеджер", "Инструменты", "Готово"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  code: "Код",
  graph: "Граф",
  search: "Поиск",
  context: "Контекст",
  design: "Дизайн",
  memory: "Память",
  agents: "Агенты",
};

export function SetupWizard() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [job, setJob] = useState<{ jobId: string; failed: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/status", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(`статус недоступен (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as SetupStatus;
      setStatus(data);
      setLoadError(null);
      setSelectedTools((prev) => {
        if (prev.size > 0) return prev;
        return new Set(data.tools.filter((tool) => tool.recommended && !tool.binInstalled).map((tool) => tool.id));
      });
    } catch {
      setLoadError("статус недоступен - сервер не отвечает");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(async (url: string, body: unknown): Promise<{ ok: boolean; jobId?: string; error?: string }> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string };
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: true, jobId: data.jobId };
    } catch {
      return { ok: false, error: "сервер не отвечает" };
    }
  }, []);

  const startSystem = async (targets: string[]) => {
    setBusy(true);
    setActionError(null);
    const result = await post("/api/setup/system", { targets });
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error ?? "запуск установки не удался");
      return;
    }
    if (result.jobId) setJob({ jobId: result.jobId, failed: false });
    else void load();
  };

  const startTools = async () => {
    setBusy(true);
    setActionError(null);
    const result = await post("/api/setup/tools", { toolIds: Array.from(selectedTools) });
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error ?? "запуск установки не удался");
      return;
    }
    if (result.jobId) setJob({ jobId: result.jobId, failed: false });
    else void load();
  };

  const savePackageManager = async (pm: "bun" | "npm") => {
    setStatus((prev) => (prev ? { ...prev, packageManager: pm } : prev));
    const result = await post("/api/setup/package-manager", { packageManager: pm });
    if (!result.ok) setActionError(result.error ?? "выбор не сохранён");
  };

  const finish = async (skipped: boolean) => {
    setBusy(true);
    const result = await post("/api/setup/complete", { skipped });
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error ?? "завершение не сохранено");
      return;
    }
    router.replace("/agent");
  };

  if (loadError && !status) {
    return (
      <Page title="Установка Harness" description="Первичная настройка: система, пакетный менеджер, инструменты.">
        <Notice tone="error">{loadError}</Notice>
      </Page>
    );
  }
  if (!status) {
    return (
      <Page title="Установка Harness" description="Первичная настройка: система, пакетный менеджер, инструменты.">
        <p className="text-sm text-fg-muted">загрузка статуса…</p>
      </Page>
    );
  }

  const missingDeps = status.deps.filter((dep) => !dep.ok);
  const toolsOk = status.tools.filter((tool) => tool.binInstalled).length;

  return (
    <Page
      title="Установка Harness"
      description="Первичная настройка: проверка системы, пакетный менеджер, установка инструментов. Шаги можно пропускать - доустановить всё можно позже в разделе Настройки → Инструменты."
      actions={
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void finish(true)}>
          Пропустить установку
        </Button>
      }
    >
      <div className="space-y-4">
        {!status.required ? (
          <Notice tone="info">
            Установка уже настроена. Страница доступна для повторного прохода: детект и установка идемпотентны.
          </Notice>
        ) : null}

        <ol className="flex flex-wrap gap-2">
          {STEPS.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                disabled={job !== null || index > step}
                onClick={() => setStep(index)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  index === step ? "border-accent/50 bg-accent/10 text-fg" : "border-line bg-surface/60 text-fg-muted hover:bg-raised"
                }`}
              >
                <span className="font-mono text-[10px] text-fg-faint">{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        {actionError ? <Notice tone="error">{actionError}</Notice> : null}

        {step === 0 ? (
          <SystemStep
            status={status}
            job={job}
            busy={busy}
            onInstall={(targets) => void startSystem(targets)}
            onDone={() => {
              const failed = job?.failed ?? false;
              setJob(null);
              if (!failed) void load();
            }}
            onJobFail={() => setJob((prev) => (prev ? { ...prev, failed: true } : prev))}
          />
        ) : null}

        {step === 1 ? (
          <Panel title="Пакетный менеджер глобальных npm-пакетов">
            <div className="grid gap-2 sm:grid-cols-2">
              <RadioRow
                name="pm"
                checked={status.packageManager === "bun"}
                onChange={() => void savePackageManager("bun")}
                title="Bun"
                description="bun add -g / bunx"
                disabled={busy || job !== null}
              />
              <RadioRow
                name="pm"
                checked={status.packageManager === "npm"}
                onChange={() => void savePackageManager("npm")}
                title="NPM"
                description="npm install -g / npx"
                disabled={busy || job !== null}
              />
            </div>
            <p className="mt-3 text-[11px] text-fg-faint">
              Выбор общий с terminal-скриптом setup.sh (файл .agents/console/package-manager.json). bun недоступен - доступен только npm.
            </p>
          </Panel>
        ) : null}

        {step === 2 ? (
          <Panel
            title="Инструменты консоли"
            actions={
              <Button
                size="sm"
                variant="accent"
                disabled={busy || job !== null || selectedTools.size === 0}
                onClick={() => void startTools()}
              >
                Установить выбранное ({selectedTools.size})
              </Button>
            }
          >
            <p className="mb-3 text-[11px] text-fg-muted">
              Рекомендованный набор предвыбран. Тонкая настройка (scope, режимы, per-runtime) - раздел Настройки → Инструменты. Уже установленные пропускаются автоматически.
            </p>
            {job ? (
              <InstallTerminal
                jobId={job.jobId}
                streamUrl={`/api/tools/job?jobId=${encodeURIComponent(job.jobId)}`}
                inputUrl="/api/tools/job/input"
                onDone={(exitCode) => {
                  const failed = exitCode !== null && exitCode !== 0;
                  setJob((prev) => (prev ? { ...prev, failed } : prev));
                  if (!failed) {
                    setJob(null);
                    void load();
                  }
                }}
              />
            ) : null}
            <div className="mt-3 space-y-3">
              {Object.entries(CATEGORY_LABELS).map(([category, label]) => {
                const tools = status.tools.filter((tool) => tool.category === category);
                if (tools.length === 0) return null;
                return (
                  <div key={category}>
                    <p className="mb-1 text-[10px] font-semibold tracking-wide text-fg-faint uppercase">{label}</p>
                    <div className="space-y-1">
                      {tools.map((tool) => (
                        <ToolRow
                          key={tool.id}
                          tool={tool}
                          checked={selectedTools.has(tool.id)}
                          disabled={busy || job !== null}
                          onChange={(value) =>
                            setSelectedTools((prev) => {
                              const next = new Set(prev);
                              if (value) next.add(tool.id);
                              else next.delete(tool.id);
                              return next;
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : null}

        {step === 3 ? (
          <Panel title="Готово">
            <div className="space-y-3">
              <Notice tone={missingDeps.length === 0 ? "success" : "info"}>
                {missingDeps.length === 0
                  ? "Системные компоненты на месте."
                  : `Не установлены: ${missingDeps.map((dep) => dep.title).join(", ")}. Установка доступна в шаге "Система" или через bun run setup.`}
              </Notice>
              <p className="text-sm text-fg-muted">
                Инструменты с установленным CLI: {toolsOk} из {status.tools.length}. Зависимости воркспейса:{" "}
                {status.workspaceDepsInstalled ? "установлены" : "не установлены (шаг Система → bun install)"}.
              </p>
              <Button variant="accent" disabled={busy} onClick={() => void finish(false)}>
                Перейти в консоль
              </Button>
            </div>
          </Panel>
        ) : null}

        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" disabled={step === 0 || job !== null} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Назад
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="sm" variant="neutral" disabled={job !== null} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Далее
            </Button>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

function SystemStep({
  status,
  job,
  busy,
  onInstall,
  onDone,
  onJobFail,
}: {
  status: SetupStatus;
  job: { jobId: string; failed: boolean } | null;
  busy: boolean;
  onInstall(targets: string[]): void;
  onDone(): void;
  onJobFail(): void;
}) {
  const missingDeps = status.deps.filter((dep) => !dep.ok);
  const interactiveBlocked = (status.system.platform === "darwin" && !status.system.hasBrew) || status.system.platform === "win32";
  return (
    <div className="space-y-4">
      <Panel
        title="Системные компоненты"
        actions={
          missingDeps.length > 0 ? (
            <Button size="sm" variant="accent" disabled={busy || job !== null} onClick={() => onInstall(missingDeps.map((dep) => dep.id))}>
              Установить недостающее
            </Button>
          ) : (
            <Chip tone="emerald">все на месте</Chip>
          )
        }
      >
        <div className="space-y-2">
          {status.deps.map((dep) => (
            <div key={dep.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 px-3 py-2">
              <span className="min-w-40 text-xs text-fg">{dep.title}</span>
              {dep.ok ? (
                <Chip tone="emerald">{dep.version ?? "установлен"}</Chip>
              ) : dep.installed ? (
                <Chip tone="amber">{`версия ${dep.version} - требуется ≥ ${dep.minMajor}`}</Chip>
              ) : (
                <Chip tone="red">не найден</Chip>
              )}
              <span className="text-[11px] text-fg-faint">{dep.purpose}</span>
            </div>
          ))}
          {!status.workspaceDepsInstalled ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 px-3 py-2">
              <span className="min-w-40 text-xs text-fg">Зависимости воркспейса</span>
              <Chip tone="amber">node_modules отсутствует</Chip>
              <Button size="xs" variant="neutral" disabled={busy || job !== null} onClick={() => onInstall(["workspace"])}>
                bun install
              </Button>
            </div>
          ) : null}
        </div>
        {interactiveBlocked && missingDeps.length > 0 ? (
          <div className="mt-3">
            <Notice tone="error">
              Автоматическая установка недоступна (нет Homebrew или ОС не поддерживается) - выполните bun run setup в терминале.
            </Notice>
          </div>
        ) : null}
        {job ? (
          <div className="mt-3 space-y-2">
            {job.failed ? <Notice tone="error">Установка завершилась с ошибкой - вывод ниже, повтор доступен после исправления.</Notice> : null}
            <InstallTerminal
              jobId={job.jobId}
              streamUrl={`/api/tools/job?jobId=${encodeURIComponent(job.jobId)}`}
              inputUrl="/api/tools/job/input"
              onDone={(exitCode) => {
                if (exitCode !== null && exitCode !== 0) onJobFail();
                else onDone();
              }}
            />
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Системные утилиты">
          <div className="flex flex-wrap gap-1.5">
            {status.utils.map((util) => (
              <Chip key={util.id} tone={util.installed ? "emerald" : "red"}>
                {util.id}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-faint">Проверяются, установки не требуют. Отсутствующие ставятся пакетами ОС.</p>
        </Panel>
        <Panel title="Рантаймы агентов">
          <div className="flex flex-wrap gap-1.5">
            {status.runtimes.map((runtime) => (
              <Chip key={runtime.id} tone={runtime.installed ? "emerald" : "dim"}>
                {runtime.title}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-faint">Детект сведений. Рантаймы ставятся пользователем самостоятельно - в установку не входят.</p>
        </Panel>
      </div>
    </div>
  );
}

function ToolRow({
  tool,
  checked,
  disabled,
  onChange,
}: {
  tool: SetupTool;
  checked: boolean;
  disabled: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
        checked ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-raised/60"
      } ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled || tool.state === "on"}
        ariaLabel={`Установить ${tool.title}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-fg">
          {tool.title}
          {tool.binInstalled ? <span className="ml-2 font-mono text-[10px] text-fg-faint">{tool.binVersion ?? "установлен"}</span> : null}
        </span>
        <span className="block truncate text-[11px] text-fg-faint">{tool.description}</span>
      </span>
      {tool.state === "on" ? <Chip tone="emerald">установлен</Chip> : null}
    </label>
  );
}
