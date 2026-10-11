"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useConsoleStore } from "@/store/console";
import { Button, Chip, confirmDialog, EmptyState, Footnote, Loading, Notice, Panel, Segmented } from "@/uikit";

type ProcessSource = "runtime" | "mcp" | "tool" | "provider";
type ProcessSafety = "none" | "duplicate" | "stale" | "orphan";

interface InventoryProcess {
  pid: number;
  ppid: number;
  uptime: string;
  uptimeSeconds: number;
  cpu: number;
  mem: number;
  command: string;
  kind: "app" | "cli";
  source: ProcessSource;
  originId: string;
  originLabel: string;
  managedDashboard: boolean;
  port: number | null;
  safety: ProcessSafety;
  safetyReason: string | null;
}

interface InventoryData {
  at: string;
  processes: InventoryProcess[];
  totals: { count: number; cpu: number; mem: number; safe: number; bySource: Record<ProcessSource, number> };
}

type SourceFilter = "all" | ProcessSource;
type SortKey = "source" | "originLabel" | "pid" | "uptimeSeconds" | "cpu" | "mem" | "command";
type SortDir = "asc" | "desc";

const SOURCE_FILTERS: readonly { key: SourceFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "runtime", label: "Рантаймы" },
  { key: "mcp", label: "MCP" },
  { key: "tool", label: "Инструменты" },
  { key: "provider", label: "Провайдеры" },
];

const SOURCE_LABELS: Record<ProcessSource, string> = {
  runtime: "рантайм",
  mcp: "mcp",
  tool: "инструмент",
  provider: "провайдер",
};

const SOURCE_CHIP_TONES: Record<ProcessSource, "sky" | "emerald" | "neutral" | "amber"> = {
  runtime: "sky",
  mcp: "emerald",
  tool: "neutral",
  provider: "amber",
};

const SAFETY_LABELS: Record<Exclude<ProcessSafety, "none">, string> = {
  duplicate: "безопасно: дубликат",
  stale: "безопасно: не отвечает",
  orphan: "безопасно: без владельца",
};

/**
 * Вкладка "Процессы" (Мониторинг): единый список процессов рантаймов,
 * MCP-серверов, локальных провайдеров и инструментов - ресурсы (CPU/MEM),
 * сортировка, остановка и маркер "безопасно остановить" для лишних
 * процессов (дубликаты, зависшие дашборды, осиротевшие MCP-серверы).
 */
export function ProcessesPanel() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fetchTabData = useConsoleStore((s) => s.fetchTabData);

  const load = useCallback(
    async (ttlMs = 10_000) => {
      const fresh = await fetchTabData<InventoryData>("monitoring-processes", "/api/monitoring/processes", ttlMs);
      if (fresh) {
        setData(fresh);
        setLoadError(null);
      } else {
        setLoadError("не удалось загрузить список процессов");
      }
    },
    [fetchTabData],
  );

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "command" || key === "source" || key === "originLabel" ? "asc" : "desc");
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    const dir = sortDir === "asc" ? 1 : -1;
    return data.processes
      .filter((p) => filter === "all" || p.source === filter)
      .sort((a, b) => {
        const va = a[sortKey];
        const vb = b[sortKey];
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb), "ru") * dir;
      });
  }, [data, filter, sortKey, sortDir]);

  const act = async (proc: InventoryProcess) => {
    if (
      !(await confirmDialog({
        title: "Остановить процесс?",
        message: `PID ${proc.pid} (${proc.originLabel})${proc.safetyReason ? `\n${proc.safetyReason}` : ""}\n${proc.command.slice(0, 160)}`,
        confirmLabel: "Стоп",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusyPid(proc.pid);
    setNotice(null);
    try {
      const res = await fetch("/api/monitoring/processes/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: proc.pid, action: "stop" }),
      });
      const result = (await res.json()) as { ok: boolean; detail: string; error?: string };
      setNotice(`Стоп PID ${proc.pid}: ${result.detail ?? result.error ?? "ошибка запроса"}`);
      await load(0);
    } finally {
      setBusyPid(null);
    }
  };

  if (loadError && !data) return <Notice tone="error">{loadError}</Notice>;
  if (!data) return <Loading />;

  const totals = data.totals;
  const counts = { all: totals.count, ...totals.bySource };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          options={SOURCE_FILTERS.map((f) => ({ ...f, count: counts[f.key] }))}
          value={filter}
          onChange={setFilter}
          ariaLabel="фильтр источников процессов"
        />
        <span className="flex items-center gap-2 text-[11px] text-fg-faint">
          процессов: {totals.count} · CPU {totals.cpu}% · MEM {totals.mem}% · безопасно: {totals.safe}
          <Button size="xs" variant="ghost" onClick={() => void load(0)}>
            <RefreshCw size={12} aria-hidden /> обновить
          </Button>
        </span>
      </div>

      {notice ? <Notice tone="info" className="mb-1">{notice}</Notice> : null}

      <Panel title={`Процессы${filter === "all" ? "" : ` · ${SOURCE_FILTERS.find((f) => f.key === filter)?.label}`}`}>
        {visible.length === 0 ? (
          <EmptyState>Процессов этой категории нет. Рантаймы, MCP-серверы, провайдеры и инструменты появятся здесь после запуска.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-faint">
                  <Th label="источник" k="source" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="процесс" k="originLabel" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="pid" k="pid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="uptime" k="uptimeSeconds" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="cpu%" k="cpu" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="mem%" k="mem" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="команда" k="command" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th className="py-1.5 text-right">действия</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.pid} className="border-b border-line/50 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <Chip tone={SOURCE_CHIP_TONES[p.source]}>{SOURCE_LABELS[p.source]}</Chip>
                        {p.managedDashboard ? <Chip tone="dim" title="автономный инстанс, запущенный консолью">консоль</Chip> : null}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-fg-muted">{p.originLabel}</td>
                    <td className="py-1.5 pr-3 font-mono text-fg-muted">{p.pid}</td>
                    <td className="py-1.5 pr-3 text-fg-muted">{p.uptime}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{p.cpu}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{p.mem}</td>
                    <td className="max-w-[22rem] py-1.5 pr-3">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-[11px] text-fg-faint" title={p.command}>
                          {p.command}
                        </span>
                        {p.safety !== "none" ? (
                          <Chip tone="emerald" title={p.safetyReason ?? undefined}>
                            {SAFETY_LABELS[p.safety]}
                          </Chip>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <Button variant="danger" size="xs" disabled={busyPid === p.pid} onClick={() => void act(p)}>
                        стоп
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Footnote className="mt-3">
          Источники: рантаймы (Claude, Codex, ZCode, Cursor, Kimi, OpenCode), MCP-серверы, локальные провайдеры и CLI инструментов. Стоп: SIGTERM, до 3 с
          грации, затем SIGKILL; перед сигналом PID перепроверяется по свежему снимку ps. Маркер "безопасно" ставится автоматически и означает, что процесс
          лишний и на текущую работу не влияет: дубликат - порт дашборда обслуживает другой процесс; не отвечает - управляемый консолью дашборд не принимает
          соединения; без владельца - MCP-сервер пережил завершившийся рантайм. Процессы рантаймов маркером не помечаются.
        </Footnote>
      </Panel>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="py-1.5 pr-3">
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={`сортировка по полю ${label}`}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wide ${active ? "text-fg" : "hover:text-fg"}`}
      >
        {label}
        {active ? <span aria-hidden>{sortDir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}
