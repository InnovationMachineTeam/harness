"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Chip, EmptyState, Loading, Notice, Panel, Toggle } from "@/uikit";

/**
 * Секция "Оценка навыков" вкладки "Оптимизация": прогон evals master-навыков
 * (evals/evals.json) у выбранных исполнителей с судьёй-провайдером. Задача
 * раннера видна в "Мониторинг → Задачи"; сводки прогонов - под формой.
 */

interface CatalogEntryDTO {
  skillId: string;
  title: string;
  tags: string[];
  caseCount: number;
}

interface SummaryDTO {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  judge: string;
  runtimes: string[];
  skills: Array<{ skillId: string; title: string; caseCount: number; passed: number; judged: number }>;
  totals: { cases: number; passed: number; failed: number; errors: number };
}

interface EvalsStateDTO {
  catalog: CatalogEntryDTO[];
  executor: string;
  executors: string[];
  reports: SummaryDTO[];
}

function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function SkillEvalsSection() {
  const [data, setData] = useState<EvalsStateDTO | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [runtimes, setRuntimes] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: ReactNode } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/evals", { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as EvalsStateDTO;
      setData(json);
      setSkills((prev) => (prev.length ? prev : json.catalog.map((entry) => entry.skillId)));
      setRuntimes((prev) => (prev.length ? prev : [json.executor]));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSkill = (skillId: string, value: boolean) => {
    setSkills((prev) => (value ? [...prev, skillId] : prev.filter((item) => item !== skillId)));
  };

  const toggleRuntime = (runtimeId: string, value: boolean) => {
    setRuntimes((prev) => (value ? [...new Set([...prev, runtimeId])] : prev.filter((item) => item !== runtimeId)));
  };

  const start = async () => {
    setStarting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/skills/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillIds: skills, runtimes }),
      });
      const json = (await res.json()) as { ok?: boolean; id?: string; detail?: string; error?: string };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "error", text: json.error ?? "запуск не выполнен" });
        return;
      }
      setNotice({
        tone: "success",
        text: (
          <>
            оценка запущена ({json.detail}); задача - в разделе{" "}
            <Link href="/monitoring" className="underline decoration-dotted hover:text-fg-muted">
              Мониторинг
            </Link>
          </>
        ),
      });
      await load();
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - запуск не выполнен" });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Panel
      as="article"
      title="Оценка навыков"
      actions={
        <div className="flex items-center gap-2">
          {starting ? <Loading>запуск…</Loading> : null}
          <Button variant="accent" onClick={() => void start()} disabled={starting || !data || skills.length === 0 || runtimes.length === 0}>
            Запустить оценку
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Кейсы evals/evals.json master-навыков исполняются у выбранных исполнителей (headless-рантайм или провайдер);
        судья-провайдер проверяет утверждения каждого кейса. Отчёт - в папке задачи (.agents/console/tasks/&lt;id&gt;/skill-evals/).
      </p>

      {notice ? (
        <Notice tone={notice.tone} className="mb-3">
          {notice.text}
        </Notice>
      ) : null}

      {!data ? (
        <Loading>загрузка каталога…</Loading>
      ) : data.catalog.length === 0 ? (
        <EmptyState size="sm">Навыки с evals не найдены в мастер-каталоге.</EmptyState>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Навыки</p>
            {data.catalog.map((entry) => (
              <div key={entry.skillId} className="flex items-center gap-3 border-t border-line/40 py-2 first:border-t-0">
                <Toggle
                  checked={skills.includes(entry.skillId)}
                  onChange={(value) => toggleSkill(entry.skillId, value)}
                  ariaLabel={`оценка навыка ${entry.title}`}
                />
                <span className="min-w-0 text-sm text-fg">
                  {entry.title}
                  <Chip tone="dim" size="xs" className="ml-1">
                    {entry.caseCount} кейсов
                  </Chip>
                </span>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Исполнители</p>
            <div className="flex flex-wrap gap-1.5">
              {data.executors.map((runtimeId) => (
                <button
                  key={runtimeId}
                  type="button"
                  onClick={() => toggleRuntime(runtimeId, !runtimes.includes(runtimeId))}
                  className={
                    "rounded-md px-2 py-1 text-xs transition-colors " +
                    (runtimes.includes(runtimeId) ? "bg-accent/20 text-fg" : "bg-surface text-fg-muted hover:text-fg")
                  }
                >
                  {runtimeId}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Прогоны</p>
            {data.reports.length === 0 ? (
              <p className="py-2 text-[11px] text-fg-faint">прогонов ещё не было</p>
            ) : (
              data.reports.slice(0, 8).map((report) => (
                <div key={report.id} className="flex flex-wrap items-center gap-2 border-t border-line/40 py-2 first:border-t-0">
                  <span className="text-xs text-fg-faint">{formatStamp(report.startedAt)}</span>
                  <span className="text-sm text-fg">
                    пройдено {report.totals.passed} из {report.totals.cases}
                  </span>
                  <Chip tone={report.status === "completed" ? "dim" : report.status === "running" ? "sky" : "amber"} size="xs">
                    {report.status === "running" ? "выполняется" : report.status === "completed" ? "завершён" : "ошибка"}
                  </Chip>
                  {report.totals.errors > 0 ? (
                    <Chip tone="amber" size="xs">
                      ошибок исполнения: {report.totals.errors}
                    </Chip>
                  ) : null}
                  <span className="text-[11px] text-fg-faint">
                    {report.runtimes.join(", ")} · судья {report.judge}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
