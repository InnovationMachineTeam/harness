"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Chip, EmptyState, Loading, Notice, Panel, Tabs } from "@/uikit";

/**
 * Секция "Библиотека уроков" вкладки "Оптимизация": постоянное хранилище
 * .agents/lessons/. "Собрать" агрегирует предложения из lessons-артефактов
 * прогонов и ретроспектив спринтов; оператор принимает (решающее правило
 * внедряется движком workflow в задания секций) или отклоняет уроки.
 */

type LessonStatus = "proposed" | "adopted" | "rejected";

interface LessonDTO {
  id: string;
  title: string;
  statement: string;
  reason: string;
  target: string;
  domain: string;
  domainLabel: string;
  status: LessonStatus;
  provenance: { source: string; runId: string; sprintId: string };
  createdAt: string;
  adoptedAt: string | null;
}

interface LessonsStateDTO {
  lessons: LessonDTO[];
  counts: Record<LessonStatus, number>;
}

type StatusTab = "proposed" | "adopted" | "rejected";

const STATUS_TABS = (counts: Record<string, number>): readonly { key: StatusTab; label: string; badge?: number }[] => [
  { key: "proposed", label: "Предложенные", badge: counts.proposed ?? 0 },
  { key: "adopted", label: "Принятые", badge: counts.adopted ?? 0 },
  { key: "rejected", label: "Отклонённые", badge: counts.rejected ?? 0 },
];

function sourceRef(lesson: LessonDTO): string {
  if (lesson.provenance.source === "sprint-retrospective") return "спринт " + (lesson.provenance.sprintId || "-");
  return "прогон " + (lesson.provenance.runId || "-");
}

export function LessonsSection() {
  const [data, setData] = useState<LessonsStateDTO | null>(null);
  const [tab, setTab] = useState<StatusTab>("proposed");
  const [collecting, setCollecting] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [statements, setStatements] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: ReactNode } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lessons", { cache: "no-store" });
      setData(res.ok ? ((await res.json()) as LessonsStateDTO) : null);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const collect = async () => {
    setCollecting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "collect" }),
      });
      const json = (await res.json()) as { ok?: boolean; added?: number; sources?: number; error?: string };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "error", text: json.error ?? "сбор не выполнен" });
        return;
      }
      setNotice({ tone: "success", text: `собрано уроков: ${json.added ?? 0} (источников: ${json.sources ?? 0})` });
      await load();
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - сбор не выполнен" });
    } finally {
      setCollecting(false);
    }
  };

  const decide = async (lesson: LessonDTO, status: "adopted" | "rejected") => {
    setDeciding(lesson.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/lessons/${lesson.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, statement: statements[lesson.id] }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "error", text: json.error ?? "решение не сохранено" });
        return;
      }
      await load();
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - решение не сохранено" });
    } finally {
      setDeciding(null);
    }
  };

  const lessons = (data?.lessons ?? []).filter((lesson) => lesson.status === tab);

  return (
    <Panel
      as="article"
      title="Библиотека уроков"
      actions={
        <div className="flex items-center gap-2">
          {collecting ? <Loading>сбор из прогонов…</Loading> : null}
          <Button variant="primary" onClick={() => void collect()} disabled={collecting}>
            Собрать из прогонов
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Постоянное хранилище .agents/lessons/: предложения из lessons-шагов прогонов и ретроспектив спринтов.
        Принятый урок становится решающим правилом и внедряется движком workflow в задания секций новых прогонов.
      </p>

      {notice ? (
        <Notice tone={notice.tone} className="mb-3">
          {notice.text}
        </Notice>
      ) : null}

      {!data ? (
        <Loading>загрузка библиотеки…</Loading>
      ) : (
        <div className="space-y-3">
          <Tabs tabs={STATUS_TABS(data.counts)} active={tab} onChange={setTab} size="sm" />
          {lessons.length === 0 ? (
            <EmptyState size="sm">
              {tab === "proposed" ? "Предложенных уроков нет - нажмите \"Собрать из прогонов\"." : "Записей нет."}
            </EmptyState>
          ) : (
            <div>
              {lessons.map((lesson) => (
                <div key={lesson.id} className="border-t border-line/40 py-2.5 first:border-t-0">
                  <p className="text-sm text-fg">
                    {lesson.title} <Chip tone="neutral" size="xs" className="ml-1">{lesson.domainLabel}</Chip>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">{lesson.reason}</p>
                  <p className="mt-0.5 text-[11px] text-fg-faint font-mono">
                    {sourceRef(lesson)}{lesson.target ? " · " + lesson.target : ""}
                  </p>
                  {lesson.status === "proposed" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={statements[lesson.id] ?? ""}
                        onChange={(event) => setStatements((prev) => ({ ...prev, [lesson.id]: event.target.value }))}
                        placeholder="решающее правило: при [условие] выполняй [действие], потому что [эффект]"
                        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus:outline-none"
                      />
                      <Button size="xs" variant="accent" onClick={() => void decide(lesson, "adopted")} disabled={deciding === lesson.id}>
                        Принять
                      </Button>
                      <Button size="xs" variant="ghostDim" onClick={() => void decide(lesson, "rejected")} disabled={deciding === lesson.id}>
                        Отклонить
                      </Button>
                    </div>
                  ) : lesson.status === "adopted" && lesson.statement ? (
                    <p className="mt-1 text-xs text-fg-muted">Правило: {lesson.statement}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
