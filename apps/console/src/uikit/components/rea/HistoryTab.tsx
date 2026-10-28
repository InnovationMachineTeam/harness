"use client";

import { useState } from "react";
import { Button, Chip, EmptyState, Notice, Panel } from "@/uikit";
import { RunTerminal, type ReaAnalysisItem } from "./ReaWorkspace";

/**
 * Вкладка "История": реестр анализов и сборок сред (.agents/console/rea/
 * analyses.jsonl); действия - evidence-отчёт и повтор запуска.
 */
export function HistoryTab({
  analyses,
  onEvidence,
  refresh,
}: {
  analyses: ReaAnalysisItem[];
  onEvidence: (analysisId: string) => void;
  refresh: () => Promise<void>;
}) {
  const [repeat, setRepeat] = useState<{ jobId: string; analysisId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repeatRun = async (entry: ReaAnalysisItem) => {
    setError(null);
    try {
      const body =
        entry.action === "environment"
          ? { action: "environment", harPath: entry.target, name: entry.name }
          : { action: "analysis", operation: entry.operation, target: entry.target, ...(entry.provider ? { provider: entry.provider } : {}) };
      const res = await fetch("/api/rea/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { jobId?: string; analysisId?: string; error?: string };
      if (!res.ok || !json.jobId || !json.analysisId) setError(json.error ?? `HTTP ${res.status}`);
      else setRepeat({ jobId: json.jobId, analysisId: json.analysisId });
    } catch {
      setError("не удалось повторить запуск");
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Анализы и среды">
        {analyses.length === 0 ? (
          <EmptyState>Анализов ещё не было - начните со вкладки "Анализ".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-fg-faint">
                <tr className="border-b border-line/60">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Действие</th>
                  <th className="py-2 pr-3 font-medium">Цель</th>
                  <th className="py-2 pr-3 font-medium">Статус</th>
                  <th className="py-2 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="text-fg-muted">
                {analyses.map((entry) => (
                  <tr key={entry.id} className="border-b border-line/40">
                    <td className="py-2 pr-3 whitespace-nowrap text-fg-faint">
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono">{entry.operation}</span>
                      {entry.provider ? <span className="ml-1 text-fg-faint">({entry.provider})</span> : null}
                    </td>
                    <td className="max-w-72 truncate py-2 pr-3 font-mono" title={entry.target}>
                      {entry.action === "environment" && entry.name ? `${entry.name} - ${entry.target}` : entry.target}
                    </td>
                    <td className="py-2 pr-3">
                      <Chip size="xs" tone={entry.status === "ok" ? "emerald" : entry.status === "failed" ? "red" : "amber"}>
                        {entry.status}
                      </Chip>
                    </td>
                    <td className="py-2">
                      <span className="flex gap-2">
                        {entry.evidenceFile ? (
                          <Button variant="ghost" size="sm" onClick={() => onEvidence(entry.id)}>
                            Evidence
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={() => void repeatRun(entry)}>
                          Повторить
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {repeat ? (
        <div className="space-y-2">
          <RunTerminal
            jobId={repeat.jobId}
            onDone={() => {
              void refresh();
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => onEvidence(repeat.analysisId)}>
            Evidence-отчёт
          </Button>
        </div>
      ) : null}
    </div>
  );
}
