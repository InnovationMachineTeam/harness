"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { relativeTime } from "@/lib/format";
import { Button, Chip, EmptyState, Loading, Notice, Panel, Segmented } from "@/uikit";
import type { TaskDTO } from "@/core/tasks";

type TaskFilter = "active" | "all" | "completed";

const FILTERS: readonly { key: TaskFilter; label: string }[] = [
  { key: "active", label: "Активные" },
  { key: "all", label: "Все" },
  { key: "completed", label: "Завершённые" },
];

const STATUS_CHIPS: Record<TaskDTO["status"], { tone: "sky" | "emerald" | "red" | "amber"; label: string }> = {
  running: { tone: "sky", label: "выполняется" },
  completed: { tone: "emerald", label: "завершена" },
  failed: { tone: "red", label: "ошибка" },
  interrupted: { tone: "amber", label: "прервана" },
};

const KIND_LABELS: Record<TaskDTO["kind"], string> = {
  prompt: "промт",
  "openwiki-build": "сборка OpenWiki",
  "graphify-build": "сборка Graphify",
  "graphify-wiki": "wiki Graphify",
};

/**
 * Вкладка "Задачи" (Мониторинг): запуски промтов, запросы провайдерам и сборки
 * OpenWiki/Graphify. Задачи независимы и выполняются параллельно; по умолчанию
 * показываются активные.
 */
export function TasksPanel() {
  const [tasks, setTasks] = useState<TaskDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitoring/tasks", { cache: "no-store" });
      const json = (await res.json()) as { tasks?: TaskDTO[] };
      setTasks(json.tasks ?? []);
    } catch {
      setLoadError("не удалось загрузить список задач");
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = setInterval(() => void load(), 4000);
    const now = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => {
      clearInterval(tick);
      clearInterval(now);
    };
  }, [load]);

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (tasks === null) return <Loading />;

  const activeCount = tasks.filter((t) => t.status === "running").length;
  const visible = tasks.filter((t) => {
    if (filter === "active") return t.status === "running";
    if (filter === "completed") return t.status !== "running";
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented options={FILTERS} value={filter} onChange={setFilter} ariaLabel="фильтр задач" />
        <span className="text-[11px] text-fg-faint">
          активных: {activeCount} · опрос раз в 4 с
          <Button size="xs" variant="ghost" className="ml-2" onClick={() => void load()}>
            обновить
          </Button>
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState>
          {filter === "active"
            ? "Активных задач нет. Запустите промт, сборку OpenWiki/Graphify или запрос провайдеру - задача появится здесь."
            : "Задач пока нет."}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} nowMs={nowMs} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, nowMs }: { task: TaskDTO; nowMs: number }) {
  const status = STATUS_CHIPS[task.status];
  return (
    <Panel
      as="article"
      title={task.title}
      actions={
        <>
          <Chip tone={status.tone}>{status.label}</Chip>
          <Chip tone="muted">{KIND_LABELS[task.kind]}</Chip>
          <Chip tone="dim">{task.executorLabel}</Chip>
          {task.model ? (
            <Chip tone="dim" mono title="модель исполнителя">
              {task.model}
            </Chip>
          ) : null}
          {task.sessionHref ? (
            <Link
              href={task.sessionHref}
              className="text-[11px] text-info underline underline-offset-2"
              title={task.sessionRuntime ? `сессия рантайма ${task.sessionRuntime}` : "раздел инструмента"}
            >
              сессия
            </Link>
          ) : null}
        </>
      }
    >
      <p className="font-mono text-[11px] text-fg-faint">
        старт: {relativeTime(task.startedAt, nowMs)}
        {task.finishedAt ? ` · конец: ${relativeTime(task.finishedAt, nowMs)}` : ""}
        {task.detail ? ` · ${task.detail}` : ""}
        {task.logFile ? ` · лог: ${task.logFile}` : ""}
      </p>
    </Panel>
  );
}
