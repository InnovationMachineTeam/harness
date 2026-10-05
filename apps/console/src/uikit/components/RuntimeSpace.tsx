"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Hourglass, Lightbulb, Star } from "lucide-react";
import type { Issue, McpServerDef, RuntimeSnapshotDTO, TargetSyncResult } from "@/core/types";
import { relativeTime } from "@/lib/format";
import { effectiveTaskRuntimeSelector, useConsoleStore } from "@/store/console";
import { Button, Chip, Notice, Panel, SectionLabel, Tabs } from "@/uikit";
import { BillingPanel } from "./runtime/BillingPanel";
import { CapabilityChips } from "./CapabilityChips";
import { ModelTable } from "./ModelTable";
import { ProcessTable } from "./ProcessTable";
import { RuntimeMemoryPanel } from "./memory/RuntimeMemoryPanel";
import { SessionPanel } from "./SessionPanel";
import { SkillsPanel } from "./SkillsPanel";
import { StatusBadge } from "./StatusBadge";

type Tab = "overview" | "issues" | "skills" | "sessions" | "processes" | "subscriptions" | "memory";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "issues", label: "Диагностика" },
  { key: "skills", label: "Навыки и скрипты" },
  { key: "sessions", label: "Сессии" },
  { key: "processes", label: "Процессы" },
  { key: "subscriptions", label: "Подписки" },
  { key: "memory", label: "Память" },
];

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.key === value);
}

/** Начальная вкладка из ?tab= (ссылки задач "Мониторинг" ведут на Сессии). */
function initialTab(): Tab {
  if (typeof window === "undefined") return "overview";
  const value = new URLSearchParams(window.location.search).get("tab");
  return isTab(value) ? value : "overview";
}

export function RuntimeSpace({
  snapshot,
  repoRoot,
  isDefault,
  guardActivity,
}: {
  snapshot: RuntimeSnapshotDTO;
  repoRoot: string;
  isDefault: boolean;
  guardActivity: { at: string; source: string } | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const starred = useConsoleStore((s) => s.defaultRuntime) === snapshot.id || isDefault;
  const setDefaultRuntime = useConsoleStore((s) => s.setDefaultRuntime);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const toggleDefault = async () => {
    const next = starred ? null : snapshot.id;
    await setDefaultRuntime(next);
  };

  return (
    <main>
      <header className="mb-6">
        <Link href="/" className="text-xs text-fg-faint hover:text-fg-muted">
          <ArrowLeft size={12} aria-hidden className="inline" /> все рантаймы
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{snapshot.displayName}</h1>
          <button
            type="button"
            onClick={() => void toggleDefault()}
            title={starred ? "Снять \"рантайм по умолчанию\"" : "Сделать рантаймом по умолчанию (для запуска промтов)"}
            className={`rounded-lg border px-2 py-0.5 text-lg leading-none transition-colors ${
              starred
                ? "border-warning/50 bg-warning/10 text-warning"
                : "border-line-strong bg-surface text-fg-faint hover:text-warning"
            }`}
          >
            <Star size={18} aria-hidden fill={starred ? "currentColor" : "none"} />
          </button>
          <StatusBadge status={snapshot.status} />
          {snapshot.awaiting ? (
            <span
              className="animate-pulse rounded border border-info/40 bg-info/10 px-2 py-0.5 text-xs text-info"
              title={snapshot.awaiting.question}
            >
              <Hourglass size={12} aria-hidden className="inline" /> ждёт ввода · {relativeTime(snapshot.awaiting.since, nowMs)}
            </span>
          ) : null}
          <span className="font-mono text-[11px] text-fg-faint">{snapshot.id}</span>
        </div>
        <p className="mt-1 font-mono text-xs text-fg-faint">{snapshot.vendor?.vendorAdapter}</p>
      </header>

      <Tabs
        tabs={TABS.map((t) => ({
          ...t,
          badge: t.key === "issues" && snapshot.issues.length > 0 ? snapshot.issues.length : undefined,
        }))}
        active={tab}
        onChange={setTab}
        className="mb-6 border-b border-line/60 pb-2"
      />

      {tab === "overview" ? <OverviewTab snapshot={snapshot} nowMs={nowMs} repoRoot={repoRoot} guardActivity={guardActivity} /> : null}
      {tab === "issues" ? <IssuesTab snapshot={snapshot} /> : null}
      {tab === "skills" ? <SkillsPanel runtime={snapshot.id} /> : null}
      {tab === "sessions" ? <SessionPanel runtime={snapshot.id} /> : null}
      {tab === "processes" ? <ProcessTable runtime={snapshot.id} /> : null}
      {tab === "subscriptions" ? (
        <BillingPanel runtime={snapshot.id} models={(snapshot.vendor?.models ?? []).map((m) => ({ tier: m.tier, model: m.model }))} />
      ) : null}
      {tab === "memory" ? <RuntimeMemoryPanel runtime={snapshot.id} /> : null}
    </main>
  );
}

function OverviewTab({
  snapshot,
  nowMs,
  repoRoot,
  guardActivity,
}: {
  snapshot: RuntimeSnapshotDTO;
  nowMs: number;
  repoRoot: string;
  guardActivity: { at: string; source: string } | null;
}) {
  const [processTotals, setProcessTotals] = useState<{ count: number; cpu: number; mem: number } | null>(null);
  const [sessions, setSessions] = useState<{ supported: boolean; count: number } | null>(null);
  const [mcp, setMcp] = useState<{ servers: McpServerDef[]; targets: TargetSyncResult[] } | null>(null);

  const fetchTabData = useConsoleStore((s) => s.fetchTabData);

  const load = useCallback(async () => {
    const [p, s, m] = await Promise.all([
      fetchTabData<{ totals: { count: number; cpu: number; mem: number } }>(
        `processes:${snapshot.id}`,
        `/api/processes?runtime=${snapshot.id}`,
        10_000,
      ),
      fetchTabData<{ supported: boolean; sessions: unknown[] }>(
        `sessions:${snapshot.id}:`,
        `/api/sessions?runtime=${snapshot.id}`,
        10_000,
      ),
      fetch("/api/mcp", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (p?.totals) setProcessTotals(p.totals);
    if (s) setSessions({ supported: Boolean(s.supported), count: s.sessions?.length ?? 0 });
    if (m?.servers) setMcp(m);
  }, [fetchTabData, snapshot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Состояние">
        <dl className="space-y-1.5 text-xs">
          <Row k="статус" v={<StatusBadge status={snapshot.status} />} />
          <Row
            k="последняя активность"
            v={
              snapshot.signals[0]
                ? `${relativeTime(snapshot.signals[0].at, nowMs)} · ${snapshot.signals[0].scope === "repo" ? "этот репозиторий" : "машина"}`
                : "нет сигналов"
            }
          />
          <Row
            k="guard (репо)"
            v={guardActivity ? relativeTime(guardActivity.at, nowMs) : "нет записей"}
          />
          <Row k="hooks" v={snapshot.vendor?.hooksSupport ?? "?"} />
          <Row k="проблемы" v={`${snapshot.issues.length} (см. Диагностику)`} />
          <Row
            k="процессы"
            v={processTotals ? `${processTotals.count} шт · CPU ${processTotals.cpu}% · MEM ${processTotals.mem}%` : "…"}
          />
          <Row
            k="сессии"
            v={sessions === null ? "…" : sessions.supported ? `поддерживаются (${sessions.count} последних)` : "история в SQLite - не поддерживается"}
          />
        </dl>
      </Panel>

      <Panel title="Модели">
        <ModelTable models={snapshot.vendor?.models ?? []} />
        {snapshot.vendor && Object.keys(snapshot.vendor.capabilities).length > 0 ? (
          <>
            <SectionLabel as="h3" className="mb-1 mt-4">
              Capabilities
            </SectionLabel>
            <CapabilityChips capabilities={snapshot.vendor.capabilities} />
          </>
        ) : null}
      </Panel>

      <Panel title="MCP для этого рантайма" className="lg:col-span-2">
        {mcp === null ? (
          <p className="text-xs text-fg-faint">…</p>
        ) : mcp.servers.length === 0 ? (
          <p className="text-xs text-fg-faint">
            Реестр MCP пуст - добавьте серверы на вкладке "Навыки и MCP".
          </p>
        ) : (
          <ul className="space-y-1.5">
            {mcp.servers.map((server) => {
              const override = server.runtimeOverrides?.[snapshot.id];
              const effective = override ?? server.enabled;
              return (
                <li key={server.name} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-fg">{server.name}</span>
                  <span className="text-fg-faint">
                    {server.transport.type === "stdio" ? server.transport.command : server.transport.url}
                  </span>
                  <span className={effective ? "text-accent" : "text-fg-faint"}>
                    {effective ? "вкл" : "выкл"}
                    {override !== undefined ? " (override)" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {mcp?.targets?.length ? (
          <p className="mt-3 text-[11px] text-fg-faint">
            Последний синк:{" "}
            {mcp.targets
              .filter((t) => t.runtimes.includes(snapshot.id))
              .map((t) => `${t.label} - ${t.ok ? "ок" : `ошибка: ${t.error}`}`)
              .join("; ") || "нет таргетов для этого рантайма"}
          </p>
        ) : null}
        <p className="mt-2 font-mono text-[10px] text-fg-faint">{repoRoot}</p>
      </Panel>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/50 pb-1.5 last:border-0">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="text-right text-fg-muted">{v}</dd>
    </div>
  );
}

const SEVERITY_CHIP: Record<string, { tone: "red" | "amber" | "muted"; label: string }> = {
  error: { tone: "red", label: "ошибка" },
  warn: { tone: "amber", label: "предупреждение" },
  info: { tone: "muted", label: "инфо" },
};

function IssuesTab({ snapshot }: { snapshot: RuntimeSnapshotDTO }) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const taskRuntime = useConsoleStore(effectiveTaskRuntimeSelector("promptExecution"));

  const fix = async (issue: Issue, index: number) => {
    setBusyIdx(index);
    setNotice(null);
    try {
      const res = await fetch("/api/prompts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue, issueRuntime: snapshot.id }),
      });
      const result = (await res.json()) as { ok?: boolean; detail?: string; error?: string; logFile?: string };
      setNotice({
        ok: Boolean(result.ok),
        text: result.ok ? `${result.detail} Лог: ${result.logFile}` : (result.error ?? "не удалось запустить"),
      });
    } finally {
      setBusyIdx(null);
    }
  };

  return (
    <div className="space-y-3">
      {notice ? (
        <Notice tone={notice.ok ? "success" : "error"}>{notice.text}</Notice>
      ) : null}
      {snapshot.issues.length === 0 ? (
        <p className="rounded-xl border border-accent/20 bg-accent/5 p-6 text-sm text-accent">
          Проблем не найдено: хуки на месте, модели подтверждены, MCP-синки без ошибок.
        </p>
      ) : (
        snapshot.issues.map((issue, i) => {
          const severity = SEVERITY_CHIP[issue.severity] ?? SEVERITY_CHIP.info;
          return (
            <article
              key={i}
              className={`rounded-xl border p-4 ${
                issue.severity === "error"
                  ? "border-danger/40 bg-danger/5"
                  : issue.severity === "warn"
                    ? "border-warning/40 bg-warning/5"
                    : "border-line-strong bg-surface/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <Chip tone={severity.tone}>{severity.label}</Chip>
                <h3 className="text-sm font-medium text-fg">{issue.title}</h3>
                <Button
                  variant="accent"
                  disabled={busyIdx === i || taskRuntime === null}
                  onClick={() => void fix(issue, i)}
                  title={
                    taskRuntime === null
                      ? "Назначьте рантайм в настройках (задача \"Исполнение команд\") или выберите ★"
                      : `Запустить исправление через ${taskRuntime} (новая headless-сессия)`
                  }
                  className="ml-auto"
                >
                  {busyIdx === i ? "запуск…" : "Исправить"}
                </Button>
              </div>
              {issue.detail ? <p className="mt-2 text-xs text-fg-muted">{issue.detail}</p> : null}
              {issue.hint ? (
                <p className="mt-1 text-xs text-fg-faint">
                  <Lightbulb size={12} aria-hidden className="inline text-warning/70" /> {issue.hint}
                </p>
              ) : null}
            </article>
          );
        })
      )}
    </div>
  );
}
