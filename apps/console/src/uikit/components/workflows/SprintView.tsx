"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Footnote, Notice } from "@/uikit";
import { StepProgressChips, runActivity, type RunSectionEvent, type RunSectionNode } from "@/uikit/components/workflows/RunSections";

/** Задача спринта (блок sprint из GET /api/workflow-runs/:id). */
export type SprintTaskData = {
  itemId: string;
  title: string;
  workflowId: string;
  bucket: number;
  order: number;
  boardStatus: string;
  taskRunId: string | null;
  taskRunStatus: string | null;
  worktree: string | null;
  steps: Array<{ id: string; title: string; end: string | null }>;
};

/** Блок sprint из GET /api/workflow-runs/:id. */
export type SprintData = { id: string; title: string; status: string; tasks: SprintTaskData[] };

/** Служебный шаг спринта для полоски под корзинами. */
export type SprintServiceStep = { id: string; title: string; end: string | null };

type Event = RunSectionEvent;

const STEP_END_EVENTS = ["step.completed", "step.failed", "step.skipped"];

/** Секунды между меткой ISO и моментом now. */
function secondsSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
}

/** Тон Chip для статуса прогона задачи. */
function runStatusTone(status: string | null | undefined): "emerald" | "amber" | "red" | "sky" | "dim" {
  if (status === "completed") return "emerald";
  if (status === "waiting") return "amber";
  if (status === "failed" || status === "interrupted" || status === "cancelled") return "red";
  if (status === "running" || status === "queued") return "sky";
  return "dim";
}

/** Тон Chip для статуса задачи на доске. */
function boardStatusTone(status: string): "emerald" | "amber" | "red" | "sky" | "dim" {
  if (status === "done") return "emerald";
  if (status === "review") return "amber";
  if (status === "blocked") return "red";
  if (status === "in-progress") return "sky";
  return "dim";
}

/** Метка статуса доски на русском. */
const BOARD_STATUS_LABELS: Record<string, string> = {
  "ready": "готова",
  "in-progress": "в работе",
  "review": "на подтверждении",
  "done": "выполнена",
  "blocked": "остановлена",
};

/** Символ шага в строке задачи: завершён, текущий, ожидает, провален. */
function stepMark(end: string | null, current: boolean): { text: string; className: string; title: string } {
  if (end === "step.completed") return { text: "●", className: "text-accent", title: "шаг завершён" };
  if (end === "step.failed") return { text: "✕", className: "text-danger", title: "шаг провален" };
  if (end === "step.skipped") return { text: "◌", className: "text-fg-faint", title: "шаг пропущен" };
  if (current) return { text: "◐", className: "text-info", title: "шаг выполняется" };
  return { text: "○", className: "text-fg-faint", title: "шаг ожидает" };
}

/** Строка задачи в корзине: порядок, заголовок, статусы и точки шагов. */
function TaskRow({ task, active, onSelect }: { task: SprintTaskData; active: boolean; onSelect: () => void }) {
  const live = task.taskRunStatus === "running" || task.taskRunStatus === "waiting";
  const currentIndex = task.steps.findIndex((step) => !step.end);
  return <button
    type="button"
    onClick={onSelect}
    className={`block w-full rounded-lg border bg-surface p-2 text-left transition-colors hover:border-info/50 ${active ? "border-info/60" : "border-line"}`}
  >
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-fg-faint">{task.order + 1}.</span>
      <span className="min-w-0 flex-1 truncate font-medium" title={task.title}>{task.title}</span>
      <Chip tone={boardStatusTone(task.boardStatus)}>{BOARD_STATUS_LABELS[task.boardStatus] ?? task.boardStatus}</Chip>
      <Chip tone="dim" mono>{task.workflowId}</Chip>
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-0.5 font-mono text-[11px]" title="Шаги workflow задачи">
        {task.steps.map((step, index) => {
          const mark = stepMark(step.end, live && index === currentIndex);
          return <span key={step.id} className={mark.className} title={`${step.title}: ${mark.title}`}>{mark.text}</span>;
        })}
      </span>
      {task.taskRunStatus ? <Chip tone={runStatusTone(task.taskRunStatus)}>{task.taskRunStatus}</Chip> : <Chip tone="dim">ожидает запуска</Chip>}
    </div>
    {task.worktree ? <div className="mt-1 truncate font-mono text-[10px] text-fg-faint" title={task.worktree}>{task.worktree}</div> : null}
  </button>;
}

/** Панель активной задачи: шаги её прогона с обновлением по SSE. */
function TaskPanel({ taskRunId, nowMs }: { taskRunId: string; nowMs: number }) {
  const [nodes, setNodes] = useState<RunSectionNode[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    setNodes([]);
    setEvents([]);
    setStatus("");
    setError("");
    let alive = true;
    const load = () => fetch(`/api/workflow-runs/${taskRunId}`, { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (!alive) return;
      if (data.error) { setError(String(data.error)); return; }
      setStatus(String(data.run?.status ?? ""));
      setNodes(((data.run?.snapshot?.nodes ?? []) as Array<RunSectionNode & { hidden?: boolean }>).filter((node) => !node.hidden));
    }).catch(() => undefined);
    void load();
    const source = new EventSource(`/api/workflow-runs/${taskRunId}/events`);
    const receive = (event: MessageEvent) => {
      const value = JSON.parse(event.data) as Event;
      setEvents((old) => old.some((item) => item.id === value.id) ? old : [...old, value]);
      if (value.type.startsWith("run.")) void load();
    };
    source.addEventListener("workflow", receive as EventListener);
    source.addEventListener("done", () => { void load(); source.close(); });
    return () => { alive = false; source.close(); };
  }, [taskRunId]);

  const endStates = new Map<string, string>();
  for (const event of events) {
    if (event.stepId && STEP_END_EVENTS.includes(event.type)) endStates.set(event.stepId, event.type);
  }
  const activity = useMemo(() => runActivity(events), [events]);

  if (error) return <section className="rounded-xl border border-line bg-page p-3"><Notice tone="error">Задача: {error}</Notice></section>;
  return <section className="space-y-2 rounded-xl border border-line bg-page p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">Прогон задачи</span>
      <Chip tone={runStatusTone(status)}>{status || "загрузка"}</Chip>
      <span className="font-mono text-[10px] text-fg-faint">{taskRunId}</span>
      <span className="ml-auto"><Button href={`/workflows/runs/${taskRunId}`}>Открыть прогон</Button></span>
    </div>
    {activity ? <div className="flex flex-wrap items-center gap-2 rounded border border-info/30 bg-page/60 px-2 py-1 text-xs">
      <Chip tone="sky">выполняется</Chip>
      <span className="font-semibold">{nodes.find((node) => node.id === activity.stepId)?.title ?? activity.stepId}</span>
      {activity.section ? <span className="text-fg-muted">· {activity.section}</span> : null}
      <span className="font-mono text-fg-muted">{activity.runtime}{activity.model ? " · " + activity.model : ""}</span>
      <span className="ml-auto font-mono text-fg-faint">секция {secondsSince(activity.startedAt, nowMs)} с · активность {secondsSince(activity.lastAt, nowMs)} с назад</span>
    </div> : null}
    <div className="space-y-1">
      {nodes.map((node) => {
        const end = endStates.get(node.id) ?? null;
        const mark = stepMark(end, !end && activity?.stepId === node.id);
        return <div key={node.id} className={`rounded-lg border bg-surface p-2 ${end === "step.failed" ? "border-danger/40" : "border-line"}`}>
          <div className="flex items-center gap-2 text-xs">
            <span className={`font-mono ${mark.className}`} title={mark.title}>{mark.text}</span>
            <span className="min-w-0 flex-1 truncate">{node.title}</span>
            {end ? <Chip tone={end === "step.completed" ? "emerald" : end === "step.failed" ? "red" : "dim"}>{end.replace("step.", "")}</Chip> : null}
          </div>
          <div className="mt-1"><StepProgressChips node={node} events={events} /></div>
        </div>;
      })}
      {!nodes.length ? <Footnote>Событий задачи ещё нет.</Footnote> : null}
    </div>
  </section>;
}

/**
 * Экран спринта: корзины со строками задач слева, панель активной задачи с шагами справа,
 * служебные шаги (worktrees, close, lessons) в полоске под корзинами.
 */
export function SprintView({ sprint, serviceSteps, nowMs }: { sprint: SprintData; serviceSteps: SprintServiceStep[]; nowMs: number }) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const buckets = useMemo(() => [...new Set(sprint.tasks.map((task) => task.bucket))].sort((a, b) => a - b), [sprint.tasks]);
  const done = sprint.tasks.filter((task) => task.boardStatus === "done").length;
  const active = (selectedItemId ? sprint.tasks.find((task) => task.itemId === selectedItemId) : undefined)
    ?? sprint.tasks.find((task) => task.taskRunStatus === "running")
    ?? sprint.tasks.find((task) => task.taskRunStatus === "waiting")
    ?? null;

  if (!sprint.tasks.length) return <section className="rounded-xl border border-line bg-page p-3"><Notice>В спринте нет задач.</Notice></section>;

  return <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Chip tone={sprint.status === "completed" ? "emerald" : sprint.status === "failed" ? "red" : "sky"}>{sprint.status}</Chip>
        <span className="text-fg-muted">задач: {sprint.tasks.length} · выполнено: {done}</span>
      </div>
      {buckets.map((bucket) => <div key={bucket} className="space-y-1">
        <div className="text-xs font-semibold text-fg-muted">Корзина {bucket}</div>
        {sprint.tasks.filter((task) => task.bucket === bucket).map((task) => <TaskRow
          key={task.itemId}
          task={task}
          active={active?.itemId === task.itemId}
          onSelect={() => setSelectedItemId(task.itemId)}
        />)}
      </div>)}
      {serviceSteps.length ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
        <span className="text-xs text-fg-muted">Служебные:</span>
        {serviceSteps.map((step) => <span key={step.id} className="flex items-center gap-1 text-xs">
          <span className={step.end === "step.completed" ? "text-accent" : step.end === "step.failed" ? "text-danger" : "text-fg-faint"}>
            {step.end === "step.completed" ? "●" : step.end === "step.failed" ? "✕" : "○"}
          </span>
          {step.title}
        </span>)}
      </div> : null}
    </section>
    {active?.taskRunId
      ? <TaskPanel key={active.taskRunId} taskRunId={active.taskRunId} nowMs={nowMs} />
      : <section className="rounded-xl border border-line bg-page p-3">
        {active
          ? <Notice>Задача «{active.title}» ожидает запуска: шаги появятся после старта её прогона.</Notice>
          : <Notice>Активной задачи нет: спринт завершён или остановлен до старта задач.</Notice>}
      </section>}
  </div>;
}
