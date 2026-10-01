"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { ActivityStatus, DashboardDataDTO } from "@/core/types";
import { relativeTime, WINDOW_OPTIONS } from "@/lib/format";
import { useConsoleStore } from "@/store/console";
import { Button, PageHeader, Segmented } from "@/ui/UIKit";
import { RuntimeCard } from "./RuntimeCard";

const REFRESH_MS = 10_000;

const COUNT_COLORS: Record<ActivityStatus, string> = {
  "active-now": "text-accent",
  "recently-active": "text-warning",
  inactive: "text-fg-faint",
  disabled: "text-fg-faint",
  unknown: "text-fg-faint",
};

const COUNT_LABELS: Record<ActivityStatus, string> = {
  "active-now": "активны",
  "recently-active": "недавно",
  inactive: "неактивны",
  disabled: "не установлены",
  unknown: "нет данных",
};

export function Dashboard({ initial }: { initial: DashboardDataDTO }) {
  const [data, setData] = useState(initial);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const windowKey = useConsoleStore((s) => s.windowKey);
  const auto = useConsoleStore((s) => s.autoRefresh);
  const defaultRuntime = useConsoleStore((s) => s.defaultRuntime);
  const setWindowKey = useConsoleStore((s) => s.setWindowKey);
  const setAuto = useConsoleStore((s) => s.setAutoRefresh);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/runtimes?window=${windowKey}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as DashboardDataDTO);
    } catch {
      // сеть недоступна - остаёмся на прошлом срезе
    }
  }, [windowKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const acc: Record<ActivityStatus, number> = {
      "active-now": 0,
      "recently-active": 0,
      inactive: 0,
      disabled: 0,
      unknown: 0,
    };
    for (const r of data.runtimes) acc[r.status] += 1;
    return acc;
  }, [data]);

  const repoName = data.repoRoot.split("/").filter(Boolean).pop() ?? data.repoRoot;

  return (
    <main>
      <PageHeader
        className="mb-8"
        title="Рантаймы"
        description={
          <>
            репозиторий <span className="font-mono text-fg-muted">{repoName}</span>
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-2">
              <Segmented
                options={WINDOW_OPTIONS}
                value={windowKey}
                onChange={setWindowKey}
                ariaLabel="Окно недавности"
              />
              <Button variant={auto ? "primary" : "ghostDim"} onClick={() => setAuto(!auto)}>
                авто {auto ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
              </Button>
            </div>
            <p className="text-[11px] text-fg-faint">
              обновлено {relativeTime(data.generatedAt, nowMs)}
              {data.guardActivity ? (
                <>
                  {" · "}
                  <span title={data.guardActivity.source}>guard: {relativeTime(data.guardActivity.at, nowMs)}</span>
                </>
              ) : (
                " · guard: нет записей"
              )}
            </p>
          </>
        }
      >
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {(Object.keys(counts) as ActivityStatus[]).map((status) =>
            counts[status] > 0 ? (
              <span key={status} className={COUNT_COLORS[status]}>
                {counts[status]} {COUNT_LABELS[status]}
              </span>
            ) : null,
          )}
        </p>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.runtimes.map((r) => (
          <RuntimeCard key={r.id} snapshot={r} nowMs={nowMs} isDefault={defaultRuntime === r.id} />
        ))}
      </div>

      {data.runtimes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-faint">
          Рантаймы не обнаружены: ожидается <span className="font-mono">.agents/runtime/&lt;vendor&gt;/config.json</span>{" "}
          в корне репозитория.
        </p>
      ) : null}

      <footer className="mt-10 border-t border-line/60 pt-4 text-[11px] leading-relaxed text-fg-faint">
        Статусы: "активен сейчас" - сигнал ≤ 5 минут; "был активен" - в пределах выбранного окна; далее - неактивен;
        "не установлен" - нет маркеров установки. Клик по карточке - пространство рантайма (диагностика, навыки,
        сессии, процессы). Источники сигналов - mtime-маркеры сессий и ps; содержимое сессий не читается без
        открытия.
      </footer>
    </main>
  );
}
