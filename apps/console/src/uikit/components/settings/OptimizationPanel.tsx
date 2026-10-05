"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Chip, EmptyState, Footnote, Loading, Notice, Panel, Tabs, Toggle } from "@/uikit";

/**
 * Вкладка "Оптимизация": отчёты Claude Insights (срез Claude Code) и CodeBurn
 * (расход токенов по всем рантаймам). Отчёт формирует провайдер (POST
 * /api/optimization/report); "Оптимизировать" запускает выбранные рекомендации
 * у исполнителя из "Основных" (POST /api/optimization/run).
 */

type OptimizationKind = "claudeInsights" | "codeburn";
type Impact = "high" | "medium" | "low";

interface Recommendation {
  id: string;
  title: string;
  detail: string;
  impact?: Impact;
}

interface OptimizationReportDTO {
  generatedAt: string;
  recommendations: Recommendation[];
}

interface OptimizationReadinessDTO {
  claudeInstalled: boolean;
  codeburnInstalled: boolean;
  codeburnEnabled: boolean;
}

interface OptimizationStateDTO {
  reports: Record<OptimizationKind, OptimizationReportDTO | null>;
  lastOptimizedAt: Record<OptimizationKind, string | null>;
  executor: string;
  readiness: OptimizationReadinessDTO;
}

const KIND_TABS: readonly { key: OptimizationKind; label: string }[] = [
  { key: "claudeInsights", label: "Claude Insights" },
  { key: "codeburn", label: "CodeBurn" },
];

const KIND_TITLES: Record<OptimizationKind, string> = {
  claudeInsights: "Claude Insights",
  codeburn: "CodeBurn",
};

const KIND_DESCRIPTIONS: Record<OptimizationKind, string> = {
  claudeInsights:
    "Сессии, модели и инструменты Claude Code за 30 дней. Отчёт формирует провайдер по сводке статистики; рекомендации оптимизируют работу с рантаймом.",
  codeburn:
    "Расход токенов и стоимость по всем рантаймам и провайдерам за 30 дней. Отчёт формирует провайдер; рекомендации направлены на снижение расхода.",
};

const IMPACT_CHIP: Record<Impact, { tone: "emerald" | "amber" | "dim"; label: string }> = {
  high: { tone: "emerald", label: "высокий эффект" },
  medium: { tone: "amber", label: "средний эффект" },
  low: { tone: "dim", label: "низкий эффект" },
};

function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "нет";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "нет" : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function OptimizationPanel() {
  const [kind, setKind] = useState<OptimizationKind>("claudeInsights");
  const [data, setData] = useState<OptimizationStateDTO | null>(null);
  const [selected, setSelected] = useState<Record<OptimizationKind, string[]>>({ claudeInsights: [], codeburn: [] });
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: ReactNode } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/optimization", { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as OptimizationStateDTO;
      setData(json);
      // выбор по умолчанию - все рекомендации отчёта
      setSelected({
        claudeInsights: json.reports.claudeInsights?.recommendations.map((rec) => rec.id) ?? [],
        codeburn: json.reports.codeburn?.recommendations.map((rec) => rec.id) ?? [],
      });
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const report = data?.reports[kind] ?? null;

  /** Отчёт вида недоступен: нет Claude Code (Claude Insights) или инструмента CodeBurn (CodeBurn). */
  const missing =
    !data ||
    (kind === "claudeInsights" && !data.readiness.claudeInstalled) ||
    (kind === "codeburn" && (!data.readiness.codeburnInstalled || !data.readiness.codeburnEnabled));

  const refreshReport = async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/optimization/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = (await res.json()) as { ok?: boolean; report?: OptimizationReportDTO; error?: string };
      if (!res.ok || !json.ok || !json.report) {
        setNotice({ tone: "error", text: json.error ?? "отчёт не сформирован" });
        return;
      }
      // новый отчёт: выбор сбрасывается на "все рекомендации"
      setSelected((prev) => ({ ...prev, [kind]: json.report!.recommendations.map((rec) => rec.id) }));
      setData((prev) => (prev ? { ...prev, reports: { ...prev.reports, [kind]: json.report! } } : prev));
      setNotice({ tone: "success", text: `отчёт сформирован: рекомендаций - ${json.report.recommendations.length}` });
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - отчёт не сформирован" });
    } finally {
      setGenerating(false);
    }
  };

  const optimize = async () => {
    setRunning(true);
    setNotice(null);
    try {
      const res = await fetch("/api/optimization/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ids: selected[kind] }),
      });
      const json = (await res.json()) as { ok?: boolean; runtime?: string; logFile?: string; detail?: string; error?: string };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "error", text: json.error ?? "запуск не выполнен" });
        return;
      }
      const stamp = new Date().toISOString();
      setData((prev) => (prev ? { ...prev, lastOptimizedAt: { ...prev.lastOptimizedAt, [kind]: stamp } } : prev));
      setNotice({
        tone: "success",
        text: (
          <>
            оптимизация запущена у исполнителя {json.runtime}; ответ - в{" "}
            <span className="font-mono">{json.logFile}</span> (задача - в разделе{" "}
            <Link href="/monitoring" className="underline decoration-dotted hover:text-fg-muted">
              Мониторинг
            </Link>
            )
          </>
        ),
      });
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - запуск не выполнен" });
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id: string, value: boolean) => {
    setSelected((prev) => {
      const current = prev[kind];
      return { ...prev, [kind]: value ? [...current, id] : current.filter((item) => item !== id) };
    });
  };

  return (
    <div className="space-y-4">
      <Tabs tabs={KIND_TABS} active={kind} onChange={setKind} size="sm" className="mb-2" />

      <Panel
        as="article"
        title={KIND_TITLES[kind]}
        actions={
          <div className="flex items-center gap-2">
            {generating ? <Loading>формируется отчёт…</Loading> : null}
            <Button variant="primary" onClick={() => void refreshReport()} disabled={generating || running || missing}>
              Обновить отчёт
            </Button>
            <Button
              variant="accent"
              onClick={() => void optimize()}
              disabled={generating || running || missing || !report || selected[kind].length === 0}
            >
              Оптимизировать
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">{KIND_DESCRIPTIONS[kind]}</p>
        <Footnote className="mb-3">
          Последняя оптимизация: {formatStamp(data?.lastOptimizedAt[kind])} · Отчёт обновлён: {formatStamp(report?.generatedAt)} ·
          Исполнитель: {data?.executor ?? "…"} (настройка - в разделе "Основные")
        </Footnote>

        {notice ? (
          <Notice tone={notice.tone} className="mb-3">
            {notice.text}
          </Notice>
        ) : null}

        {generating ? (
          <Loading>провайдер анализирует статистику; ожидание до 5 минут…</Loading>
        ) : !data ? (
          <Loading>загрузка состояния…</Loading>
        ) : kind === "claudeInsights" && !data.readiness.claudeInstalled ? (
          <EmptyState>
            Claude Code не установлен на этой машине - установите Claude Code и выполните вход (раздел{" "}
            <Link href="/runtimes" className="underline decoration-dotted hover:text-fg-muted">
              Рантаймы
            </Link>
            ); отчёт Claude Insights анализирует его сессии.
          </EmptyState>
        ) : kind === "codeburn" && !data.readiness.codeburnInstalled ? (
          <EmptyState>
            CodeBurn не установлен - установите инструмент в разделе{" "}
            <Link href="/settings?tab=tools" className="underline decoration-dotted hover:text-fg-muted">
              Настройки → Инструменты
            </Link>
            ; отчёт CodeBurn требует установленный инструмент.
          </EmptyState>
        ) : kind === "codeburn" && !data.readiness.codeburnEnabled ? (
          <EmptyState>
            CodeBurn не активирован - включите инструмент в разделе{" "}
            <Link href="/settings?tab=tools" className="underline decoration-dotted hover:text-fg-muted">
              Настройки → Инструменты
            </Link>
            .
          </EmptyState>
        ) : report ? (
          <>
            {report.recommendations.length === 0 ? (
              <EmptyState size="sm">Отчёт пуст - рекомендаций нет. Сформируйте отчёт повторно.</EmptyState>
            ) : (
              <div>
                {report.recommendations.map((rec) => {
                  const checked = selected[kind].includes(rec.id);
                  const impact = rec.impact ? IMPACT_CHIP[rec.impact] : null;
                  return (
                    <div key={rec.id} className="flex items-start gap-3 border-t border-line/40 py-2.5 first:border-t-0">
                      <Toggle checked={checked} onChange={(value) => toggle(rec.id, value)} ariaLabel={`оптимизация: ${rec.title}`} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm text-fg">
                          {rec.title} {impact ? <Chip tone={impact.tone} size="xs" className="ml-1">{impact.label}</Chip> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">{rec.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : data ? (
          <EmptyState>Отчёт не сформирован - нажмите "Обновить отчёт".</EmptyState>
        ) : (
          <Loading>загрузка состояния…</Loading>
        )}
      </Panel>
    </div>
  );
}
