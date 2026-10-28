"use client";

import { useState } from "react";
import { Button, Input, Notice, Panel, Select } from "@/uikit";
import { RunTerminal, type ReaCatalogItem, type ReaProviderInfo } from "./ReaWorkspace";

/**
 * Вкладка "Анализ": общий анализ цели (rea analyze, analyze-javascript-application)
 * с выбором провайдера; evidence-отчёт пишется в .agents/console/rea/evidence/.
 */
export function AnalyzeTab({
  catalog,
  providers,
  refresh,
  onEvidence,
}: {
  catalog: ReaCatalogItem[];
  providers: ReaProviderInfo[];
  refresh: () => Promise<void>;
  onEvidence: (analysisId: string) => void;
}) {
  const [operation, setOperation] = useState(catalog[0]?.id ?? "analyze");
  const [target, setTarget] = useState("");
  const [provider, setProvider] = useState("auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ jobId: string; analysisId: string } | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setExitCode(null);
    try {
      const res = await fetch("/api/rea/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analysis", operation, target, ...(provider !== "auto" ? { provider } : {}) }),
      });
      const json = (await res.json()) as { jobId?: string; analysisId?: string; error?: string };
      if (!res.ok || !json.jobId || !json.analysisId) setError(json.error ?? `HTTP ${res.status}`);
      else setJob({ jobId: json.jobId, analysisId: json.analysisId });
    } catch {
      setError("не удалось запустить анализ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Анализ цели">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Операция</p>
            <Select
              value={operation}
              onChange={setOperation}
              options={catalog.map((op) => ({ value: op.id, label: op.label }))}
              ariaLabel="операция анализа"
            />
            <p className="mt-1 text-xs text-fg-faint">{catalog.find((op) => op.id === operation)?.hint}</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Цель (абсолютный путь)</p>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="/Applications/App.app или /путь/к/бинарнику"
              aria-label="путь к цели анализа"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Провайдер нативного анализа</p>
            <Select
              value={provider}
              onChange={setProvider}
              options={[
                { value: "auto", label: "Авто (по цели)" },
                ...providers.map((p) => ({ value: p.id, label: p.name })),
              ]}
              ariaLabel="провайдер анализа"
            />
            <p className="mt-1 text-xs text-fg-faint">
              Провайдеры (Ghidra, Hopper, IDA, JADX) ставятся отдельно; встроенные статические анализы работают без них.
            </p>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button variant="accent" size="sm" onClick={run} disabled={busy || !target.trim()}>
            {busy ? "Запуск..." : "Запустить анализ"}
          </Button>
        </div>
      </Panel>

      {job ? (
        <div className="space-y-2">
          <RunTerminal
            jobId={job.jobId}
            onDone={(code) => {
              setExitCode(code);
              void refresh();
            }}
          />
          {exitCode !== null ? (
            exitCode === 0 ? (
              <Button variant="ghost" size="sm" onClick={() => onEvidence(job.analysisId)}>
                Показать evidence-отчёт
              </Button>
            ) : (
              <Notice tone="error">Анализ завершился с кодом {exitCode} - детали в терминале.</Notice>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
