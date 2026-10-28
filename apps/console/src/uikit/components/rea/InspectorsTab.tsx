"use client";

import { useState } from "react";
import { Button, Input, Notice, Panel, Select } from "@/uikit";
import { RunTerminal, type ReaCatalogItem } from "./ReaWorkspace";

/**
 * Вкладка "Инспекторы": точечные операции rea inspect-* по форматам (SQLite,
 * PE, ELF, Go, Rust, модели, IL2CPP и другие) без внешних движков.
 */
export function InspectorsTab({
  catalog,
  refresh,
  onEvidence,
}: {
  catalog: ReaCatalogItem[];
  refresh: () => Promise<void>;
  onEvidence: (analysisId: string) => void;
}) {
  const [operation, setOperation] = useState(catalog[0]?.id ?? "inspect-artifact");
  const [target, setTarget] = useState("");
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
        body: JSON.stringify({ action: "analysis", operation, target }),
      });
      const json = (await res.json()) as { jobId?: string; analysisId?: string; error?: string };
      if (!res.ok || !json.jobId || !json.analysisId) setError(json.error ?? `HTTP ${res.status}`);
      else setJob({ jobId: json.jobId, analysisId: json.analysisId });
    } catch {
      setError("не удалось запустить инспектор");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Инспектор формата">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Операция</p>
            <Select
              value={operation}
              onChange={setOperation}
              options={catalog.map((op) => ({ value: op.id, label: op.label }))}
              ariaLabel="инспектор формата"
            />
            <p className="mt-1 text-xs text-fg-faint">{catalog.find((op) => op.id === operation)?.hint}</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Файл (абсолютный путь)</p>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="/путь/к/файлу (база, бинарник, отчёт)"
              aria-label="путь к файлу инспекции"
            />
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button variant="accent" size="sm" onClick={run} disabled={busy || !target.trim()}>
            {busy ? "Запуск..." : "Запустить инспектор"}
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
              <Notice tone="error">Инспекция завершилась с кодом {exitCode} - детали в терминале.</Notice>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
