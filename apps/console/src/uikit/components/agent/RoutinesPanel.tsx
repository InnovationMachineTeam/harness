"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { relativeTime } from "@/lib/format";
import { Button, Chip, EmptyState, FieldLabel, Input, Loading, Modal, Notice, Panel, Segmented, Select, Textarea, Toggle, confirmDialog } from "@/uikit";
import type { RuntimeSnapshotDTO } from "@/core/types";
import type { RoutineRecord, RoutineRunRecord } from "@/core/workflows/storage";

interface RoutinesData {
  routines: RoutineRecord[];
  runs: RoutineRunRecord[];
}

interface RoutineForm {
  id: string | null;
  title: string;
  prompt: string;
  executor: string;
  scheduleType: "interval" | "cron";
  intervalMin: string;
  cronExpr: string;
  enabled: boolean;
}

type RoutineScheduleType = "interval" | "cron";

const SCHEDULE_OPTIONS: readonly { key: RoutineScheduleType; label: string }[] = [
  { key: "interval", label: "Интервал" },
  { key: "cron", label: "Cron" },
];

const RUN_STATUS_CHIPS: Record<RoutineRunRecord["status"], { tone: "sky" | "emerald" | "red"; label: string }> = {
  running: { tone: "sky", label: "выполняется" },
  completed: { tone: "emerald", label: "завершён" },
  failed: { tone: "red", label: "ошибка" },
};

function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0 && minutes >= 1440) return `каждые ${minutes / 1440} дн`;
  if (minutes % 60 === 0 && minutes >= 60) return `каждые ${minutes / 60} ч`;
  return `каждые ${minutes} мин`;
}

function scheduleLabel(routine: Pick<RoutineRecord, "scheduleType" | "intervalMin" | "cronExpr">): string {
  return routine.scheduleType === "cron" && routine.cronExpr ? `cron ${routine.cronExpr}` : intervalLabel(routine.intervalMin);
}

/**
 * Вкладка "Рутины" раздела "Агент": периодические запуски промта по интервалу.
 * Исполнение - workflow-воркер; кнопка "Запустить" ставит запрос ручного
 * запуска, результат виден в списке последних запусков и в "Мониторинг → Задачи".
 */
export function RoutinesPanel({ runtimes }: { runtimes: RuntimeSnapshotDTO[] }) {
  const [data, setData] = useState<RoutinesData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<RoutineForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/routines", { cache: "no-store" });
      const json = (await res.json()) as RoutinesData & { error?: string };
      if (json.error) throw new Error(json.error);
      setData({ routines: json.routines ?? [], runs: json.runs ?? [] });
    } catch {
      setLoadError("не удалось загрузить рутины");
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = setInterval(() => void load(), 5000);
    const now = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => {
      clearInterval(tick);
      clearInterval(now);
    };
  }, [load]);

  const executorOptions = useMemo(() => ([
    { value: "provider", label: "Провайдер по умолчанию", group: "Провайдеры" },
    ...runtimes.map((runtime) => ({ value: runtime.id, label: runtime.displayName, group: "Рантаймы" })),
  ]), [runtimes]);

  const executorLabel = useCallback((executor: string) => {
    if (executor.startsWith("provider:")) return "провайдер " + executor.slice("provider:".length);
    return runtimes.find((runtime) => runtime.id === executor)?.displayName ?? executor;
  }, [runtimes]);

  const openCreate = () => setForm({ id: null, title: "", prompt: "", executor: "provider", scheduleType: "interval", intervalMin: "60", cronExpr: "", enabled: true });
  const openEdit = (routine: RoutineRecord) => setForm({
    id: routine.id,
    title: routine.title,
    prompt: routine.prompt,
    executor: routine.executor,
    scheduleType: routine.scheduleType,
    intervalMin: routine.intervalMin ? String(routine.intervalMin) : "60",
    cronExpr: routine.cronExpr ?? "",
    enabled: routine.enabled,
  });

  const submitForm = async () => {
    if (!form) return;
    setBusy(true);
    setActionError(null);
    try {
      const body = {
        title: form.title,
        prompt: form.prompt,
        executor: form.executor,
        scheduleType: form.scheduleType,
        intervalMin: form.scheduleType === "interval" ? Number(form.intervalMin) : undefined,
        cronExpr: form.scheduleType === "cron" ? form.cronExpr : undefined,
        enabled: form.enabled,
      };
      const res = form.id
        ? await fetch(`/api/routines/${form.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/routines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setForm(null);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const patchRoutine = async (routine: RoutineRecord, patch: Record<string, unknown>) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/routines/${routine.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const removeRoutine = async (routine: RoutineRecord) => {
    if (!(await confirmDialog({ title: "Удалить рутину?", message: routine.title, confirmLabel: "Удалить", tone: "danger" }))) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/routines/${routine.id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const runNow = async (routine: RoutineRecord) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/routines/${routine.id}`, { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (data === null) return <Loading />;

  const routineTitles = new Map(data.routines.map((routine) => [routine.id, routine.title]));
  const enabledCount = data.routines.filter((routine) => routine.enabled).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-fg-faint">
          включённых: {enabledCount} из 20 · интервал от 15 мин · запуск - workflow-воркер · опрос раз в 5 с
        </span>
        <Button variant="primary" size="sm" onClick={openCreate}>Создать рутину</Button>
      </div>

      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      {data.routines.length === 0 ? (
        <EmptyState>
          Рутин нет. Рутина запускает промт выбранным исполнителем по интервалу - например, утреннюю сводку задач и мониторинга.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {data.routines.map((routine) => (
            <Panel
              as="article"
              key={routine.id}
              title={routine.title}
              actions={
                <>
                  {routine.enabled
                    ? <Chip tone="emerald">включена</Chip>
                    : <Chip tone="muted">выключена</Chip>}
                  {routine.consecutiveFailures > 0 ? (
                    <Chip tone="amber" title="подряд неудачных запусков; после 10 рутина выключается">
                      сбоев подряд: {routine.consecutiveFailures}
                    </Chip>
                  ) : null}
                  <Chip tone="dim">{executorLabel(routine.executor)}</Chip>
                  <Chip tone="dim" mono title={routine.scheduleType === "cron" ? "cron-выражение (локальная таймзона)" : "интервал"}>{scheduleLabel(routine)}</Chip>
                  {routine.enabled && routine.nextRunAt ? (
                    <Chip tone="neutral" title={routine.nextRunAt}>следующий: {relativeTime(routine.nextRunAt, nowMs)}</Chip>
                  ) : null}
                </>
              }
            >
              <p className="mb-2 whitespace-pre-line font-mono text-[11px] text-fg-faint">{routine.prompt.slice(0, 300)}{routine.prompt.length > 300 ? "…" : ""}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle checked={routine.enabled} onChange={(value) => void patchRoutine(routine, { enabled: value })} ariaLabel="включить рутину" />
                <Button size="xs" onClick={() => void runNow(routine)}>Запустить</Button>
                <Button size="xs" onClick={() => openEdit(routine)}>Изменить</Button>
                <Button size="xs" variant="danger" onClick={() => void removeRoutine(routine)}>Удалить</Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel title="Последние запуски">
        {data.runs.length === 0 ? (
          <EmptyState size="sm">Запусков ещё не было.</EmptyState>
        ) : (
          <div className="space-y-1.5">
            {data.runs.map((run) => {
              const status = RUN_STATUS_CHIPS[run.status];
              return (
                <p key={run.id} className="flex flex-wrap items-center gap-2 text-[11px] text-fg-faint">
                  <Chip tone={status.tone}>{status.label}</Chip>
                  <Chip tone="dim">{run.trigger === "manual" ? "вручную" : "по расписанию"}</Chip>
                  <span className="text-fg-muted">{routineTitles.get(run.routineId) ?? run.routineId}</span>
                  <span>{relativeTime(run.startedAt, nowMs)}</span>
                  {run.error ? <span className="text-danger">{run.error.slice(0, 160)}</span> : null}
                </p>
              );
            })}
          </div>
        )}
      </Panel>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Изменить рутину" : "Новая рутина"}
        description="Периодический запуск промта. Расписание - интервал в минутах (15-10080) или cron-выражение по локальной таймзоне (не чаще 5 минут)."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setForm(null)}>Отмена</Button>
            <Button
              variant="primary"
              size="md"
              disabled={busy || !form?.title.trim() || !form?.prompt.trim() || (form?.scheduleType === "cron" && !form.cronExpr.trim())}
              onClick={() => void submitForm()}
            >
              {form?.id ? "Сохранить" : "Создать"}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="space-y-3">
            <div>
              <FieldLabel htmlFor="routine-title">Заголовок</FieldLabel>
              <Input id="routine-title" className="mt-1 w-full" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Утренняя сводка" />
            </div>
            <div>
              <FieldLabel htmlFor="routine-prompt">Промт</FieldLabel>
              <Textarea id="routine-prompt" className="mt-1 min-h-32 w-full" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} placeholder="Собери сводку активных задач и статусов мониторинга…" />
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-48 flex-1">
                <FieldLabel>Исполнитель</FieldLabel>
                <Select
                  className="mt-1"
                  value={form.executor}
                  options={executorOptions}
                  onChange={(value) => setForm({ ...form, executor: value })}
                  ariaLabel="исполнитель рутины"
                />
              </div>
              <div className="w-36">
                {form.scheduleType === "interval" ? (
                  <>
                    <FieldLabel htmlFor="routine-interval">Интервал, мин</FieldLabel>
                    <Input
                      id="routine-interval"
                      className="mt-1 w-full"
                      type="number"
                      min={15}
                      max={10080}
                      value={form.intervalMin}
                      onChange={(event) => setForm({ ...form, intervalMin: event.target.value })}
                    />
                  </>
                ) : (
                  <>
                    <FieldLabel htmlFor="routine-cron">Cron-выражение</FieldLabel>
                    <Input
                      id="routine-cron"
                      className="mt-1 w-56 font-mono"
                      value={form.cronExpr}
                      onChange={(event) => setForm({ ...form, cronExpr: event.target.value })}
                      placeholder="0 9 * * 1-5"
                      spellCheck={false}
                    />
                  </>
                )}
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Toggle checked={form.enabled} onChange={(value) => setForm({ ...form, enabled: value })} ariaLabel="включить рутину" />
                <span className="text-xs text-fg-faint">включена</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                options={SCHEDULE_OPTIONS}
                value={form.scheduleType}
                onChange={(value) => setForm({ ...form, scheduleType: value })}
                ariaLabel="вид расписания"
              />
              <span className="text-[10px] leading-relaxed text-fg-faint">
                {form.scheduleType === "interval"
                  ? "запуск каждые N минут (15-10080)"
                  : "поля: минута час день месяца день недели; локальная таймзона; срабатывания не чаще 5 минут"}
              </span>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
