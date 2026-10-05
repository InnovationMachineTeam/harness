"use client";

import { useEffect, useState } from "react";
import { Chip, EmptyState, Loading, Modal } from "@/uikit";
import { formatTokens, relativeTime } from "@/lib/format";

/**
 * Детализация статистики (drill-down): модалка с расшифровкой дня, модели,
 * инструмента или проекта. Данные - GET /api/stats/drill; задачи со ссылками
 * на прогоны (/workflows/runs/<id>), сессии и попытки workflow списками.
 */

export type DrillKind = "day" | "model" | "runtime" | "tool" | "project";

const KIND_TITLE: Record<DrillKind, (key: string) => string> = {
  day: (key) => `Детализация дня ${key}`,
  model: (key) => `Модель ${key}`,
  runtime: (key) => `Рантайм ${key}`,
  tool: (key) => `Инструмент ${key}`,
  project: (key) => `Проект ${key.split("/").pop() ?? key}`,
};

interface DrillSession {
  runtime: string;
  sessionId: string;
  title: string | null;
  workspaceDir: string | null;
  startedAt: string | null;
  lastActivityAt: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
  toolCalls?: number;
}

interface DrillTask {
  id: string;
  kind: string;
  title: string;
  status: string;
  model: string | null;
  startedAt: string;
  finishedAt: string | null;
  runId: string | null;
}

interface DrillAttempt {
  runId: string;
  runTitle: string;
  workflowId: string;
  runStatus: string;
  stepId: string;
  section: string | null;
  status: string;
  startedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  costValue: number | null;
}

interface DrillModelRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
}

interface DrillData {
  type: DrillKind;
  key: string;
  sessions?: DrillSession[];
  tasks?: DrillTask[];
  attempts?: DrillAttempt[];
  models?: DrillModelRow[];
  totals?: { inputTokens: number; outputTokens: number; cacheTokens: number; knownCost: number };
  calls?: number;
  days?: { day: string; calls: number }[];
}

const TASK_STATUS_TONE: Record<string, "sky" | "emerald" | "red" | "amber"> = {
  running: "sky",
  completed: "emerald",
  failed: "red",
  interrupted: "amber",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1.5 text-xs font-semibold text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function SessionsList({ sessions, showToolCalls }: { sessions: DrillSession[]; showToolCalls?: boolean }) {
  if (!sessions || sessions.length === 0) return <p className="text-xs text-fg-faint">Сессий нет.</p>;
  return (
    <ul className="space-y-1">
      {sessions.map((session) => (
        <li key={`${session.runtime}:${session.sessionId}`} className="rounded-lg border border-line bg-surface/40 px-3 py-2">
          <p className="truncate text-xs text-fg">{session.title ?? session.sessionId}</p>
          <p className="mt-0.5 text-[10px] text-fg-faint">
            {session.runtime}
            {session.workspaceDir ? ` · ${session.workspaceDir.split("/").pop()}` : ""}
            {` · ${relativeTime(session.lastActivityAt, Date.now())}`}
            {` · ${formatTokens(session.inputTokens + session.outputTokens)} ток.`}
            {session.costUsd > 0 ? ` · $${session.costUsd.toFixed(2)}` : ""}
            {showToolCalls && session.toolCalls ? ` · вызовов: ${session.toolCalls}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function TasksList({ tasks }: { tasks: DrillTask[] }) {
  if (!tasks || tasks.length === 0) return <p className="text-xs text-fg-faint">Задач нет.</p>;
  return (
    <ul className="space-y-1">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface/40 px-3 py-2">
          <Chip tone={TASK_STATUS_TONE[task.status] ?? "dim"}>{task.status}</Chip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-fg">{task.title}</p>
            <p className="mt-0.5 text-[10px] text-fg-faint">
              {task.kind}
              {task.model ? ` · ${task.model}` : ""}
              {` · ${relativeTime(task.startedAt, Date.now())}`}
            </p>
          </div>
          {task.runId ? (
            <a href={`/workflows/runs/${task.runId}`} className="shrink-0 text-[11px] text-info hover:underline">
              прогон
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function fmtTokensPair(input: number, output: number): string {
  return `${formatTokens(input + output)} ток.`;
}

export function StatsDrillModal({
  open,
  onClose,
  kind,
  keyValue,
  period,
}: {
  open: boolean;
  onClose: () => void;
  kind: DrillKind;
  keyValue: string;
  period: string;
}) {
  const [data, setData] = useState<DrillData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !keyValue) return;
    setData(null);
    setError(null);
    const params = new URLSearchParams({ type: kind, key: keyValue, period });
    void fetch(`/api/stats/drill?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(String(json.error ?? res.status));
        setData(json as DrillData);
      })
      .catch((err: Error) => setError(err.message));
  }, [open, kind, keyValue, period]);

  return (
    <Modal open={open} onClose={onClose} title={KIND_TITLE[kind](keyValue)} width="max-w-3xl">
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : !data ? (
        <Loading>Детализация…</Loading>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          {data.totals ? (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <Chip tone="muted" mono>вход+выход: {fmtTokensPair(data.totals.inputTokens, data.totals.outputTokens)}</Chip>
              <Chip tone="muted" mono>кеш: {formatTokens(data.totals.cacheTokens)}</Chip>
              {data.totals.knownCost > 0 ? <Chip tone="dim" mono>стоимость: ${data.totals.knownCost.toFixed(2)}</Chip> : null}
            </div>
          ) : null}
          {data.calls !== undefined ? (
            <div className="mb-4">
              <Chip tone="sky" mono>вызовов за период: {data.calls}</Chip>
            </div>
          ) : null}
          {data.models && data.models.length > 0 ? (
            <Section title="Модели дня">
              <ul className="space-y-1">
                {data.models.map((row) => (
                  <li key={row.model} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-[11px] text-fg">{row.model}</span>
                    <span className="shrink-0 text-fg-faint">
                      {fmtTokensPair(row.inputTokens, row.outputTokens)}
                      {row.costUsd > 0 ? ` · $${row.costUsd.toFixed(2)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {data.tasks ? (
            <Section title="Задачи консоли">
              <TasksList tasks={data.tasks} />
            </Section>
          ) : null}
          {data.attempts ? (
            <Section title="Попытки workflow">
              {!data.attempts || data.attempts.length === 0 ? (
                <p className="text-xs text-fg-faint">Попыток нет.</p>
              ) : (
                <ul className="space-y-1">
                  {data.attempts.map((attempt, index) => (
                    <li key={`${attempt.runId}:${attempt.stepId}:${index}`} className="rounded-lg border border-line bg-surface/40 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Chip tone={attempt.status === "completed" ? "emerald" : attempt.status === "running" ? "sky" : "dim"}>{attempt.status}</Chip>
                        <p className="min-w-0 flex-1 truncate text-xs text-fg">{attempt.runTitle}</p>
                        <a href={`/workflows/runs/${attempt.runId}`} className="shrink-0 text-[11px] text-info hover:underline">
                          прогон
                        </a>
                      </div>
                      <p className="mt-0.5 text-[10px] text-fg-faint">
                        {attempt.workflowId} · {attempt.stepId}
                        {attempt.section ? ` · ${attempt.section}` : ""}
                        {attempt.startedAt ? ` · ${relativeTime(attempt.startedAt, Date.now())}` : ""}
                        {` · ${fmtTokensPair(attempt.inputTokens, attempt.outputTokens)}`}
                        {attempt.costValue && attempt.costValue > 0 ? ` · $${attempt.costValue.toFixed(2)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
          {data.days && data.days.length > 0 ? (
            <Section title="Вызовы по дням">
              <div className="flex flex-wrap gap-1.5">
                {data.days.map((row) => (
                  <Chip key={row.day} tone="dim" mono>{row.day}: {row.calls}</Chip>
                ))}
              </div>
            </Section>
          ) : null}
          {data.sessions ? (
            <Section title="Сессии">
              <SessionsList sessions={data.sessions} showToolCalls={kind === "tool"} />
            </Section>
          ) : null}
          {!data.tasks && !data.sessions && !data.models && !data.attempts && data.calls === undefined ? (
            <EmptyState size="sm">Нет данных для этой детализации.</EmptyState>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
