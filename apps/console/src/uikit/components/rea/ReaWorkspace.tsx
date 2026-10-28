"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Chip, EmptyState, Modal, Notice, Panel, Tabs } from "@/uikit";
import { InstallTerminal } from "@/uikit/components/skillsSh/InstallTerminal";
import { AnalyzeTab } from "./AnalyzeTab";
import { EnvironmentsTab } from "./EnvironmentsTab";
import { HistoryTab } from "./HistoryTab";
import { InspectorsTab } from "./InspectorsTab";

/** Операция каталога (DTO GET /api/rea). */
export interface ReaCatalogItem {
  id: string;
  label: string;
  hint: string;
  tab: "analyze" | "inspectors";
}

/** Провайдер анализа (DTO GET /api/rea). */
export interface ReaProviderInfo {
  id: string;
  name: string;
}

/** Запись реестра (DTO GET /api/rea). */
export interface ReaAnalysisItem {
  id: string;
  at: string;
  action: "analysis" | "environment";
  operation: string;
  target: string;
  provider?: string;
  name?: string;
  sourcesDir?: string;
  jobId: string;
  status: "running" | "ok" | "failed";
  exitCode: number | null;
  evidenceFile?: string;
}

export interface ReaData {
  cli: { installed: boolean; version: string | null };
  providers: ReaProviderInfo[];
  providerError: string | null;
  catalog: ReaCatalogItem[];
  analyses: ReaAnalysisItem[];
}

type ReaTab = "analyze" | "inspectors" | "environments" | "history";

const TABS: { key: ReaTab; label: string }[] = [
  { key: "analyze", label: "Анализ" },
  { key: "inspectors", label: "Инспекторы" },
  { key: "environments", label: "Среды" },
  { key: "history", label: "История" },
];

/** Рабочее место "Реверс": статус rea, анализ целей, инспекторы, среды, история. */
export function ReaWorkspace() {
  const [data, setData] = useState<ReaData | null>(null);
  const [tab, setTab] = useState<ReaTab>("analyze");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [doctorJobId, setDoctorJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/rea");
      if (res.ok) setData((await res.json()) as ReaData);
    } catch {
      /* раздел остаётся с прошлыми данными */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) return <EmptyState>Загрузка статуса rea...</EmptyState>;

  const analyzeCatalog = data.catalog.filter((op) => op.tab === "analyze");
  const inspectorCatalog = data.catalog.filter((op) => op.tab === "inspectors");

  return (
    <div className="space-y-4">
      <Panel title="Инструмент rea">
        <div className="flex flex-wrap items-center gap-2">
          {data.cli.installed ? (
            <Chip mono tone="emerald" size="sm">
              rea {data.cli.version ?? "установлен"}
            </Chip>
          ) : (
            <Chip mono tone="red" size="sm">
              rea не установлен
            </Chip>
          )}
          {data.cli.installed ? (
            <Chip size="sm" tone="muted">
              Провайдеров анализа: {data.providers.length}
            </Chip>
          ) : null}
          <div className="grow" />
          <DoctorButton busyAfter={setDoctorJobId} />
        </div>
        {!data.cli.installed ? (
          <Notice tone="error" className="mt-3">
            CLI rea не найден в PATH. Установите пакет в разделе "Настройки → Инструменты → REA" или командой
            <span className="mx-1 font-mono">bun add -g rea-agents</span>.
          </Notice>
        ) : null}
        {data.providerError ? (
          <Notice tone="info" className="mt-3">
            Список провайдеров недоступен: {data.providerError}
          </Notice>
        ) : null}
      </Panel>

      {doctorJobId ? <RunTerminal jobId={doctorJobId} onDone={refresh} /> : null}

      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-4 border-b border-line/60 pb-2" />

      {tab === "analyze" ? (
        <AnalyzeTab catalog={analyzeCatalog} providers={data.providers} refresh={refresh} onEvidence={setEvidenceId} />
      ) : null}
      {tab === "inspectors" ? <InspectorsTab catalog={inspectorCatalog} refresh={refresh} onEvidence={setEvidenceId} /> : null}
      {tab === "environments" ? <EnvironmentsTab refresh={refresh} onEvidence={setEvidenceId} /> : null}
      {tab === "history" ? <HistoryTab analyses={data.analyses} onEvidence={setEvidenceId} refresh={refresh} /> : null}

      {evidenceId ? <EvidenceModal analysisId={evidenceId} onClose={() => setEvidenceId(null)} /> : null}
    </div>
  );
}

/** Кнопка диагностики: rea doctor + rea mcp doctor через job (терминал - у родителя). */
function DoctorButton({ busyAfter }: { busyAfter: (jobId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/rea/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "doctor" }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (json.jobId) busyAfter(json.jobId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={run} disabled={busy}>
      Диагностика
    </Button>
  );
}

/** Терминал job'а rea (SSE /api/tools/job). */
export function RunTerminal({ jobId, onDone }: { jobId: string; onDone?: (exitCode: number | null) => void }) {
  return (
    <div className="rounded-lg border border-line bg-page/60 p-3">
      <InstallTerminal
        jobId={jobId}
        streamUrl={`/api/tools/job?jobId=${encodeURIComponent(jobId)}`}
        inputUrl="/api/tools/job/input"
        onDone={onDone}
      />
    </div>
  );
}

/** Модалка evidence-отчёта: мета записи + JSON в моно-блоке. */
export function EvidenceModal({ analysisId, onClose }: { analysisId: string; onClose: () => void }) {
  const [data, setData] = useState<{
    analysis: ReaAnalysisItem;
    evidence: string | null;
    truncated?: boolean;
    note?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/rea/analysis?id=${encodeURIComponent(analysisId)}`);
        const json = (await res.json()) as {
          analysis?: ReaAnalysisItem;
          evidence?: string | null;
          truncated?: boolean;
          note?: string;
          error?: string;
        };
        if (!res.ok || json.error) setError(json.error ?? `HTTP ${res.status}`);
        else if (json.analysis) setData({ analysis: json.analysis, evidence: json.evidence ?? null, truncated: json.truncated, note: json.note });
      } catch {
        setError("не удалось загрузить evidence-отчёт");
      }
    })();
  }, [analysisId]);

  return (
    <Modal open onClose={onClose} title="Evidence-отчёт" width="max-w-4xl">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Chip mono size="sm">
              {data.analysis.operation}
            </Chip>
            <Chip size="sm" tone={data.analysis.status === "ok" ? "emerald" : data.analysis.status === "failed" ? "red" : "amber"}>
              {data.analysis.status}
            </Chip>
            <span className="font-mono text-fg-faint">{data.analysis.target}</span>
          </div>
          {data.note ? <Notice tone="info">{data.note}</Notice> : null}
          {data.evidence ? (
            <pre className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-page/60 p-3 font-mono text-xs text-fg-muted">
              {data.evidence}
            </pre>
          ) : !data.note ? (
            <EmptyState>evidence-файл пуст</EmptyState>
          ) : null}
          {data.truncated ? <Notice tone="info">Отчёт больше 4 МБ - показаны первые 4 МБ.</Notice> : null}
        </div>
      ) : (
        <EmptyState>Загрузка...</EmptyState>
      )}
    </Modal>
  );
}
