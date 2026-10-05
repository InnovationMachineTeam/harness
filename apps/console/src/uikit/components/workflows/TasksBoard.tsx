"use client";

import { useEffect, useMemo, useState } from "react";
import { redactComposer } from "@/lib/redactComposer";
import { Button, Chip, EmptyState, Input, Modal, Page, Select } from "@/uikit";

type BoardRun = { id: string; title: string; workflowId: string; status: string; createdAt: string; error: string | null };
type RoadmapItem = { id: string; title: string; description: string; status: string; labels: string[]; estimate?: { value?: number; effort?: number } };
type WorkflowEntry = { id: string; title: string };
type SprintRow = { itemId: string; workflowId: string; bucket: number; order: number };

const COLUMNS: Array<{ key: string; label: string; statuses: string[]; tone: "sky" | "amber" | "emerald" | "red" }> = [
  { key: "active", label: "В работе", statuses: ["queued", "running"], tone: "sky" },
  { key: "waiting", label: "Требует подтверждения", statuses: ["waiting"], tone: "amber" },
  { key: "done", label: "Выполнены", statuses: ["completed"], tone: "emerald" },
  { key: "stopped", label: "Остановлены", statuses: ["failed", "cancelled", "interrupted"], tone: "red" },
];

/**
 * Доска задач workflow: прогоны по колонкам, backlog задач из планирования
 * и визард спринта (выбор задач и workflow, затем корзины и порядок).
 */
export function TasksBoard({ embedded = false }: { embedded?: boolean }) {
  const [runs, setRuns] = useState<BoardRun[] | null>(null);
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowEntry[]>([]);
  const [message, setMessage] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const load = () => Promise.all([
    fetch("/api/workflow-runs", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/roadmap", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/workflows", { cache: "no-store" }).then((r) => r.json()),
  ]).then(([runsData, roadmapData, workflowsData]) => {
    setRuns(runsData.runs ?? []);
    setItems(roadmapData.items ?? []);
    setWorkflows(workflowsData.workflows ?? []);
  });
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);
  const columns = useMemo(() => COLUMNS.map((column) => ({
    ...column,
    items: (runs ?? []).filter((run) => column.statuses.includes(run.status)),
  })), [runs]);
  const backlog = useMemo(() => items.filter((item) => item.status === "inbox"), [items]);
  const waitingCount = columns.find((column) => column.key === "waiting")?.items.length ?? 0;
  const actions = <span className="flex items-center gap-2 text-xs text-fg-muted">
    {waitingCount ? <Chip tone="amber">подтверждений: {waitingCount}</Chip> : null}
    <Button variant="accent" onClick={() => setWizardOpen(true)}>Спринт</Button>
    <Button onClick={() => { void load(); setMessage("Обновлено"); }}>Обновить</Button>
    {message ? <span>{message}</span> : null}
  </span>;
  const board = <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
    <section className="rounded-xl border border-line bg-surface/50 p-3">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Backlog</h2><Chip tone="dim">{backlog.length}</Chip></div>
      <div className="space-y-2">
        {backlog.map((item) => <div key={item.id} className="rounded-lg border border-line bg-surface p-2">
          <div className="text-xs font-medium">{item.title}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {item.estimate?.value !== undefined ? <Chip tone="emerald" size="xs" mono>value {item.estimate.value}</Chip> : null}
            {item.estimate?.effort !== undefined ? <Chip tone="amber" size="xs" mono>effort {item.estimate.effort}</Chip> : null}
            {item.labels.filter((label) => label.startsWith("sprint:")).map((label) => <Chip key={label} tone="sky" size="xs" mono>{label.replace("sprint:", "")}</Chip>)}
          </div>
        </div>)}
        {!backlog.length ? <EmptyState size="sm">Пусто - запустите PDLC Discovery или другой workflow с планированием</EmptyState> : null}
      </div>
    </section>
    {columns.map((column) => <section key={column.key} className="rounded-xl border border-line bg-surface/50 p-3">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{column.label}</h2><Chip tone={column.tone}>{column.items.length}</Chip></div>
      <div className="space-y-2">
        {column.items.map((run) => <a key={run.id} href={`/workflows/runs/${run.id}`} className="block rounded-lg border border-line bg-surface p-2 transition-colors hover:border-info">
          <div className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium">{run.title}</span><Chip tone={column.tone} size="xs">{run.status}</Chip></div>
          <div className="mt-1 font-mono text-[10px] text-fg-faint">{run.workflowId}</div>
          {run.error ? <p className="mt-1 line-clamp-2 text-[10px] text-danger">{run.error}</p> : null}
        </a>)}
        {!column.items.length ? <EmptyState size="sm">Пусто</EmptyState> : null}
      </div>
    </section>)}
  </div>;
  if (embedded) {
    return <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">Карточка - прогон workflow; артефакты в .agents/console/tasks/&lt;run-id&gt;. Backlog наполняют шаги планирования (producesTasks); спринт выполняет задачи по корзинам в отдельных worktrees.</p>
        {actions}
      </div>
      {runs === null ? <EmptyState>Загрузка…</EmptyState> : board}
      <SprintWizard open={wizardOpen} backlog={backlog} workflows={workflows} onClose={() => setWizardOpen(false)} onDone={async (sprintId, runId) => { setWizardOpen(false); setMessage(`Спринт ${sprintId} запущен`); void load(); if (runId) window.location.href = `/workflows/runs/${runId}`; }} />
    </div>;
  }
  return <Page
    title="Задачи"
    description="Карточка - прогон workflow: папка артефактов, ошибки и возвраты в .agents/console/tasks/<id>. Подтверждения планов и ручная приёмка попадают в колонку ожидания."
    actions={actions}
  >
    {runs === null ? <EmptyState>Загрузка…</EmptyState> : board}
    <SprintWizard open={wizardOpen} backlog={backlog} workflows={workflows} onClose={() => setWizardOpen(false)} onDone={async (sprintId, runId) => { setWizardOpen(false); setMessage(`Спринт ${sprintId} запущен`); void load(); if (runId) window.location.href = `/workflows/runs/${runId}`; }} />
  </Page>;
}

/** Визард спринта: шаг 1 - выбор задач и workflow; шаг 2 - корзины и порядок. */
function SprintWizard({ open, backlog, workflows, onClose, onDone }: {
  open: boolean;
  backlog: RoadmapItem[];
  workflows: WorkflowEntry[];
  onClose: () => void;
  onDone: (sprintId: string, runId: string | null) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowWorkflows, setRowWorkflows] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<SprintRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1); setTitle(""); setSelected({}); setRowWorkflows({}); setRows([]); setError("");
    }
  }, [open]);

  const chosen = backlog.filter((item) => selected[item.id]);
  const defaultWorkflow = workflows[0]?.id ?? "";

  const toStep2 = () => {
    if (!chosen.length || !defaultWorkflow) { setError("Нужны выбранные задачи и хотя бы один workflow"); return; }
    const normalized = chosen.map((item, index) => ({
      itemId: item.id,
      workflowId: rowWorkflows[item.id] || defaultWorkflow,
      bucket: 1,
      order: index,
    }));
    setRows(normalized);
    setError("");
    setStep(2);
  };

  const move = (itemId: string, direction: -1 | 1) => {
    setRows((old) => {
      const index = old.findIndex((row) => row.itemId === itemId);
      const row = old[index];
      if (index < 0 || !row) return old;
      const candidates = old.filter((candidate) => candidate.bucket === row.bucket);
      const localIndex = candidates.findIndex((candidate) => candidate.itemId === itemId);
      const swapWith = candidates[localIndex + direction];
      if (!swapWith) return old;
      const next = [...old];
      const rowIndex = next.findIndex((candidate) => candidate.itemId === itemId);
      const swapIndex = next.findIndex((candidate) => candidate.itemId === swapWith.itemId);
      next[rowIndex] = { ...swapWith };
      next[swapIndex] = { ...row };
      return next;
    });
  };

  const launch = async () => {
    setBusy(true);
    setError("");
    const composed = redactComposer(title);
    setNotice(composed.notice ?? "");
    try {
      const counters: Record<number, number> = {};
      const normalized = rows.map((row) => {
        counters[row.bucket] = (counters[row.bucket] ?? 0);
        return { ...row, order: counters[row.bucket]++ };
      });
      const response = await fetch("/api/sprints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: composed.text, rows: normalized }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Ошибка создания спринта");
      await onDone(result.sprint.id, result.run?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const buckets = [...new Set(rows.map((row) => row.bucket))].sort((a, b) => a - b);
  return <Modal
    open={open}
    onClose={onClose}
    width="max-w-3xl"
    title={step === 1 ? "Спринт: выбор задач" : "Спринт: корзины и порядок"}
    description={step === 1
      ? "Отметьте задачи из backlog и выберите workflow для каждой; на следующем шаге задачи распределяются по параллельным корзинам."
      : "Корзины выполняются параллельно в отдельных worktrees; порядок внутри корзины - последовательность исполнения."}
    footer={<>
      {step === 2 ? <Button className="mr-auto" onClick={() => setStep(1)}>Назад</Button> : null}
      <Button variant="ghost" onClick={onClose}>Отмена</Button>
      {step === 1
        ? <Button variant="primary" disabled={!chosen.length} onClick={toStep2}>Далее ({chosen.length})</Button>
        : <Button variant="primary" disabled={busy || !rows.length} onClick={launch}>{busy ? "Запуск…" : "Запустить спринт"}</Button>}
    </>}
  >
    <div className="space-y-3">
      <Input placeholder="Название спринта (необязательно)" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-xs" />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {notice ? <p className="text-xs text-info">{notice}</p> : null}
      {step === 1 ? (backlog.length ? <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-line text-fg-muted"><th className="p-2"> </th><th className="p-2">Задача</th><th className="p-2">Оценка</th><th className="p-2">Workflow</th></tr></thead>
          <tbody>
            {backlog.map((item) => <tr key={item.id} className="border-b border-line/50">
              <td className="p-2"><input type="checkbox" checked={Boolean(selected[item.id])} onChange={(e) => setSelected((old) => ({ ...old, [item.id]: e.target.checked }))} /></td>
              <td className="p-2"><div className="font-medium">{item.title}</div>{item.description ? <div className="mt-0.5 line-clamp-1 text-[10px] text-fg-faint">{item.description}</div> : null}</td>
              <td className="p-2"><span className="flex gap-1">{item.estimate?.value !== undefined ? <Chip tone="emerald" size="xs" mono>v{item.estimate.value}</Chip> : <Chip tone="muted" size="xs">v?</Chip>}{item.estimate?.effort !== undefined ? <Chip tone="amber" size="xs" mono>e{item.estimate.effort}</Chip> : <Chip tone="muted" size="xs">e?</Chip>}</span></td>
              <td className="p-2"><Select value={rowWorkflows[item.id] || defaultWorkflow} onChange={(value) => setRowWorkflows((old) => ({ ...old, [item.id]: value }))} options={workflows.map((workflow) => ({ value: workflow.id, label: workflow.title }))} className="w-44" ariaLabel="Workflow задачи" /></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState>Backlog пуст - запустите PDLC Discovery: его шаг planning наполняет backlog задачами с оценками.</EmptyState>) : (
        <div className="max-h-[46vh] space-y-3 overflow-y-auto">
          {buckets.map((bucket) => <section key={bucket} className="rounded-lg border border-line p-2">
            <div className="mb-1"><span className="text-xs font-semibold">Корзина {bucket} (параллельно)</span></div>
            <div className="space-y-1">
              {rows.filter((row) => row.bucket === bucket).map((row) => {
                const item = backlog.find((candidate) => candidate.id === row.itemId);
                return <div key={row.itemId} className="flex items-center gap-2 rounded border border-line/60 bg-page/60 px-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate">{item?.title ?? row.itemId}</span>
                  <Chip tone="dim" size="xs" mono>{workflows.find((workflow) => workflow.id === row.workflowId)?.id ?? row.workflowId}</Chip>
                  <Select value={String(row.bucket)} onChange={(value) => setRows((old) => old.map((candidate) => candidate.itemId === row.itemId ? { ...candidate, bucket: Number(value) } : candidate))} options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: "корзина " + value }))} className="w-32" ariaLabel="Корзина задачи" />
                  <Button size="xs" onClick={() => move(row.itemId, -1)} aria-label="Выше">↑</Button>
                  <Button size="xs" onClick={() => move(row.itemId, 1)} aria-label="Ниже">↓</Button>
                </div>;
              })}
            </div>
          </section>)}
        </div>
      )}
    </div>
  </Modal>;
}
