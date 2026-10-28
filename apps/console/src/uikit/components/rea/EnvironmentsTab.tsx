"use client";

import { useState } from "react";
import { Button, Input, Notice, Panel } from "@/uikit";
import { RunTerminal } from "./ReaWorkspace";

/**
 * Вкладка "Среды": сборка агентной среды из захвата (HAR) - rea
 * environment-build пишет бандл в sources/<имя>; после сборки папку
 * регистрируют рабочей и поручают развитие агенту.
 */
export function EnvironmentsTab({ refresh, onEvidence }: { refresh: () => Promise<void>; onEvidence: (analysisId: string) => void }) {
  const [harPath, setHarPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ jobId: string; analysisId: string; sourcesDir: string } | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [registered, setRegistered] = useState(false);
  const [handoff, setHandoff] = useState<{ ok: boolean; message: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setExitCode(null);
    setRegistered(false);
    setHandoff(null);
    try {
      const res = await fetch("/api/rea/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "environment", harPath, name }),
      });
      const json = (await res.json()) as { jobId?: string; analysisId?: string; sourcesDir?: string; error?: string };
      if (!res.ok || !json.jobId || !json.analysisId || !json.sourcesDir) setError(json.error ?? `HTTP ${res.status}`);
      else setJob({ jobId: json.jobId, analysisId: json.analysisId, sourcesDir: json.sourcesDir });
    } catch {
      setError("не удалось запустить сборку среды");
    } finally {
      setBusy(false);
    }
  };

  const registerWorkspace = async () => {
    if (!job) return;
    try {
      const listRes = await fetch("/api/workspaces");
      const list = (await listRes.json()) as { additional: { path: string }[] };
      const additional = list.additional.map((item) => item.path);
      if (additional.includes(job.sourcesDir)) {
        setRegistered(true);
        return;
      }
      const res = await fetch("/api/workspaces", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional: [...additional, job.sourcesDir] }),
      });
      const json = (await res.json()) as { ok?: boolean; errors?: string[] };
      if (res.ok && json.ok) setRegistered(true);
      else setError((json.errors ?? ["не удалось зарегистрировать рабочую папку"]).join("; "));
    } catch {
      setError("не удалось зарегистрировать рабочую папку");
    }
  };

  const handoffToAgent = async () => {
    if (!job) return;
    setHandoff(null);
    try {
      const res = await fetch("/api/prompts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: job.sourcesDir,
          prompt: `Развивай реверс-среду в каталоге ${job.sourcesDir}: изучи манифест окружения и собранные файлы, проверь состав инструментов окружения, дополни README и примеры использования. Сначала краткий план, затем изменения; коммиты в этой папке выполняй по её правилам.`,
        }),
      });
      const json = (await res.json()) as { logFile?: string; error?: string; warning?: string };
      if (!res.ok) setHandoff({ ok: false, message: json.error ?? `HTTP ${res.status}` });
      else
        setHandoff({
          ok: true,
          message: `Агент запущен, лог: ${json.logFile ?? "неизвестен"}${json.warning ? ` (${json.warning})` : ""}`,
        });
    } catch {
      setHandoff({ ok: false, message: "не удалось запустить агента" });
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Среда из захвата">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Захват (HAR, абсолютный путь)</p>
            <Input
              value={harPath}
              onChange={(e) => setHarPath(e.target.value)}
              placeholder="/путь/к/записи.har"
              aria-label="путь к HAR-файлу"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Имя среды (kebab-case)</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-service-env"
              aria-label="имя среды"
            />
            <p className="mt-1 text-xs text-fg-faint">
              Бандл создаётся в <span className="font-mono">sources/&lt;имя&gt;/</span> - каталог должен отсутствовать
              или быть пустым; rea ничего не перезаписывает.
            </p>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button variant="accent" size="sm" onClick={run} disabled={busy || !harPath.trim() || !name.trim()}>
            {busy ? "Запуск..." : "Собрать среду"}
          </Button>
        </div>
      </Panel>

      {job ? (
        <div className="space-y-3">
          <RunTerminal
            jobId={job.jobId}
            onDone={(code) => {
              setExitCode(code);
              void refresh();
            }}
          />
          {exitCode !== null ? (
            exitCode === 0 ? (
              <div className="space-y-3">
                <Notice tone="success">
                  Среда собрана: <span className="font-mono">{job.sourcesDir}</span>. Зарегистрируйте папку рабочей -
                  развитие идёт сессиями и задачами в ней.
                </Notice>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={registerWorkspace} disabled={registered}>
                    {registered ? "Папка зарегистрирована" : "Зарегистрировать рабочую папку"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handoffToAgent} disabled={!registered}>
                    Поручить агенту
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onEvidence(job.analysisId)}>
                    Evidence-отчёт
                  </Button>
                </div>
                {handoff ? <Notice tone={handoff.ok ? "info" : "error"}>{handoff.message}</Notice> : null}
              </div>
            ) : (
              <Notice tone="error">Сборка завершилась с кодом {exitCode} - детали в терминале.</Notice>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
