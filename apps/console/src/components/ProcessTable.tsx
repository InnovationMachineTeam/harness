"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useConsoleStore } from "@/store/console";
import { Button, confirmDialog, Footnote, Loading, Notice, Panel } from "@/ui/UIKit";

interface PsInfo {
  pid: number;
  ppid: number;
  uptime: string;
  cpu: number;
  mem: number;
  command: string;
  kind: "app" | "cli";
}

interface ProcessesData {
  processes: PsInfo[];
  totals: { count: number; cpu: number; mem: number; apps: number };
}

export function ProcessTable({ runtime }: { runtime: string }) {
  const [data, setData] = useState<ProcessesData | null>(null);
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fetchTabData = useConsoleStore((s) => s.fetchTabData);

  // данные кешируются в store: повторное открытие вкладки мгновенно
  const load = useCallback(
    async (ttlMs = 10_000) => {
      const fresh = await fetchTabData<ProcessesData>(
        `processes:${runtime}`,
        `/api/processes?runtime=${runtime}`,
        ttlMs,
      );
      if (fresh) setData(fresh);
    },
    [fetchTabData, runtime],
  );

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (pid: number, action: "stop" | "restart") => {
    const what = action === "stop" ? "остановить" : "перезапустить";
    if (
      !(await confirmDialog({
        title: `${what[0].toUpperCase()}${what.slice(1)} процесс?`,
        message: `PID ${pid} (${runtime})`,
        confirmLabel: action === "stop" ? "Стоп" : "Рестарт",
        tone: action === "stop" ? "danger" : "primary",
      }))
    ) {
      return;
    }
    setBusyPid(pid);
    setNotice(null);
    try {
      const res = await fetch("/api/processes/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtime, pid, action }),
      });
      const result = (await res.json()) as { ok: boolean; detail: string };
      setNotice(`${action === "stop" ? "Стоп" : "Рестарт"} PID ${pid}: ${result.detail}`);
      await load(0);
    } finally {
      setBusyPid(null);
    }
  };

  return (
    <Panel
      title={`Процессы ${data ? `· ${data.totals.count} шт · CPU ${data.totals.cpu}% · MEM ${data.totals.mem}%` : "…"}`}
      actions={
        <Button variant="ghostDim" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden /> обновить
        </Button>
      }
    >
      {notice ? <Notice tone="info" className="mb-3">{notice}</Notice> : null}

      {!data ? (
        <Loading />
      ) : data.processes.length === 0 ? (
        <p className="text-xs text-fg-faint">Процессов этого рантайма не найдено.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-faint">
                <th className="py-1.5 pr-3">PID</th>
                <th className="py-1.5 pr-3">uptime</th>
                <th className="py-1.5 pr-3">CPU%</th>
                <th className="py-1.5 pr-3">MEM%</th>
                <th className="py-1.5 pr-3">тип</th>
                <th className="py-1.5 pr-3">команда</th>
                <th className="py-1.5 text-right">действия</th>
              </tr>
            </thead>
            <tbody>
              {data.processes.map((p) => (
                <tr key={p.pid} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-fg-muted">{p.pid}</td>
                  <td className="py-1.5 pr-3 text-fg-muted">{p.uptime}</td>
                  <td className="py-1.5 pr-3 text-fg-muted">{p.cpu}</td>
                  <td className="py-1.5 pr-3 text-fg-muted">{p.mem}</td>
                  <td className="py-1.5 pr-3 text-fg-faint">{p.kind === "app" ? "приложение" : "процесс"}</td>
                  <td className="max-w-[22rem] truncate py-1.5 pr-3 text-fg-muted" title={p.command}>
                    {p.command}
                  </td>
                  <td className="py-1.5 text-right">
                    <span className="inline-flex gap-1.5">
                      <Button
                        variant="danger"
                        size="xs"
                        disabled={busyPid === p.pid}
                        onClick={() => void act(p.pid, "stop")}
                      >
                        стоп
                      </Button>
                      {p.kind === "app" ? (
                        <Button
                          variant="warning"
                          size="xs"
                          disabled={busyPid === p.pid}
                          onClick={() => void act(p.pid, "restart")}
                        >
                          рестарт
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Footnote className="mt-3">
        Стоп: SIGTERM → до 3 с грации → SIGKILL; перед сигналом консоль перепроверяет, что PID всё ещё относится к
        рантайму. Рестарт - только для приложений (.app): остановка + open -a.
      </Footnote>
    </Panel>
  );
}
