"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Settings2 } from "lucide-react";
import { LIGHTRAG_PRESETS } from "@/core/llmPresets";
import { InstallTerminal } from "@/uikit/components/skillsSh/InstallTerminal";
import { LlmSettingsModal, type LlmSettingsValue } from "@/uikit/components/tools/LlmSettingsModal";
import { Button, Chip, EmptyState, IconButton, Loading, Modal, Notice, Panel } from "@/uikit";

/**
 * Вкладка "Связки" раздела "Знание": наборы памяти ("neo4j + LightRAG",
 * "neo4j + Qdrant") - установка одной задачей через POST /api/tools/action
 * (comboId), статус сервисов и дашбордов членов. Управление компонентами
 * по отдельности (вкл/выкл/удаление) - "Настройки → Инструменты".
 */

interface ComboTool {
  id: string;
  title: string;
  state: "missing" | "on" | "off";
  mcp: { registered: boolean; enabled: boolean } | null;
  dashboard: { url: string; label: string; live: boolean; managedPid: number | null; autostart: boolean } | null;
}

interface ComboDTO {
  id: string;
  title: string;
  description: string;
  toolIds: string[];
  tools: ComboTool[];
}

const STATE_CHIP: Record<ComboTool["state"], { tone: "emerald" | "amber" | "dashed"; label: string }> = {
  on: { tone: "emerald", label: "включён" },
  off: { tone: "amber", label: "выключен" },
  missing: { tone: "dashed", label: "не установлен" },
};

/** Точка-статус сервиса: зелёная - порт отвечает, жёлтая - наш инстанс без порта, красная - не запущен. */
function ServiceDot({ live, managedPid }: { live: boolean; managedPid: number | null }) {
  const tone = live ? "bg-accent" : managedPid ? "bg-warning" : "bg-danger";
  const pulse = live || managedPid ? "animate-pulse" : "";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone} ${pulse}`} />;
}

export function CombosTab() {
  const [combos, setCombos] = useState<ComboDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [job, setJob] = useState<{ comboId: string; jobId: string } | null>(null);
  const [jobFailed, setJobFailed] = useState(false);
  const [llmModal, setLlmModal] = useState<{ initial: LlmSettingsValue } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools", { cache: "no-store" });
      const json = (await res.json()) as { combos?: ComboDTO[] };
      setCombos(json.combos ?? []);
    } catch {
      setError("не удалось загрузить связки");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (combo: ComboDTO) => {
    setBusy(combo.id);
    setError(null);
    try {
      const res = await fetch("/api/tools/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", comboId: combo.id }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) setError(json.error ?? "не удалось запустить установку");
      else if (json.jobId) setJob({ comboId: combo.id, jobId: json.jobId });
      else await load();
    } catch {
      setError("не удалось запустить установку");
    } finally {
      setBusy(null);
    }
  };

  const dashAction = async (tool: ComboTool, action: "start" | "stop") => {
    setBusy(`${tool.id}:dash`);
    setNotice(null);
    try {
      const res = await fetch("/api/tools/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: tool.id, action }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      setNotice(json.detail ?? json.error ?? null);
      await load();
    } catch {
      setNotice("не удалось выполнить действие");
    } finally {
      setBusy(null);
    }
  };

  const openLlmSettings = async () => {
    try {
      const res = await fetch("/api/memory/lightrag/llm", { cache: "no-store" });
      const json = (await res.json()) as { llm?: LlmSettingsValue };
      setLlmModal({
        initial: json.llm ?? { preset: LIGHTRAG_PRESETS[0].id, apiKey: "", baseUrl: "", modelId: "" },
      });
    } catch {
      setError("не удалось загрузить LLM-настройки");
    }
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!combos) return <Loading />;
  if (combos.length === 0) return <EmptyState>Связки не определены.</EmptyState>;

  return (
    <div className="space-y-3">
      <Panel title="Связки памяти">
        <p className="text-[11px] leading-relaxed text-fg-faint">
          Установка ставит все компоненты связки одной задачей; сервисы запускаются здесь же и держатся консолью
          (автономные инстансы, только localhost). Управление компонентами по отдельности - &quot;Настройки →
          Инструменты&quot;. MCP-серверы памяти попадают в рантаймы вместе с установкой.
        </p>
        {notice ? <div className="mt-2"><Notice tone="info">{notice}</Notice></div> : null}
      </Panel>

      {combos.map((combo) => {
        const installed = combo.tools.some((t) => t.state !== "missing");
        const allInstalled = combo.tools.every((t) => t.state !== "missing");
        return (
          <Panel
            as="article"
            key={combo.id}
            title={combo.title}
            actions={
              <>
                {combo.tools.map((t) => (
                  <Chip key={t.id} tone={STATE_CHIP[t.state].tone} mono>
                    {t.id}: {STATE_CHIP[t.state].label}
                  </Chip>
                ))}
              </>
            }
          >
            <p className="mb-2 text-[11px] leading-relaxed text-fg-faint">{combo.description}</p>
            <div className="mb-2 space-y-1">
              {combo.tools.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-24 text-[11px] font-medium text-fg-muted">{t.title}</span>
                  <Chip tone={STATE_CHIP[t.state].tone}>{STATE_CHIP[t.state].label}</Chip>
                  {t.mcp?.registered ? (
                    <Chip tone={t.mcp.enabled ? "sky" : "dim"}>MCP {t.mcp.enabled ? "вкл" : "выкл"}</Chip>
                  ) : null}
                  {t.dashboard ? (
                    <>
                      <Button size="xs" variant="ghostDim" onClick={() => void dashAction(t, t.dashboard?.managedPid ? "stop" : "start")} disabled={busy !== null}>
                        <ServiceDot live={t.dashboard.live} managedPid={t.dashboard.managedPid} />
                        {t.dashboard.managedPid ? "Остановить сервис" : "Запустить сервис"}
                      </Button>
                      <IconButton
                        icon={ExternalLink}
                        label={`${t.dashboard.label}: открыть в новой вкладке`}
                        href={t.dashboard.url}
                        variant="neutral"
                        size="xs"
                      />
                    </>
                  ) : null}
                  {t.id === "lightrag" ? (
                    <IconButton icon={Settings2} label="LLM-биндинг LightRAG" variant="ghostDim" size="xs" onClick={() => void openLlmSettings()} />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {!allInstalled ? (
                  <Button size="xs" variant="accent" disabled={busy !== null} onClick={() => void install(combo)}>
                    {busy === combo.id ? "Запуск…" : installed ? "Доустановить компоненты" : "Установить связку"}
                  </Button>
                ) : (
                  <span className="text-[11px] text-fg-faint">все компоненты установлены</span>
                )}
                {combo.toolIds.includes("lightrag") ? (
                  <span className="text-[11px] text-fg-faint">
                    LightRAG стартует после настройки LLM-биндинга (шестерёнка в строке LightRAG).
                  </span>
                ) : null}
              </div>
            </div>
          </Panel>
        );
      })}
      {job ? (
        <Modal
          open
          onClose={() => {
            setJob(null);
            setJobFailed(false);
          }}
          title={`Связка · ${job.comboId} (install)`}
          width="max-w-2xl"
        >
          <InstallTerminal
            jobId={job.jobId}
            streamUrl={`/api/tools/job?jobId=${encodeURIComponent(job.jobId)}`}
            inputUrl="/api/tools/job/input"
            onDone={(exitCode) => {
              setJobFailed(exitCode !== null && exitCode !== 0);
              void load();
            }}
          />
          {jobFailed ? <div className="mt-2"><Notice tone="error">Job завершился с ошибкой - подробности в терминале.</Notice></div> : null}
        </Modal>
      ) : null}

      {llmModal ? (
        <LlmSettingsModal
          open
          onClose={() => setLlmModal(null)}
          title="LLM-биндинг · LightRAG"
          description="Биндинг передаётся lightrag-server переменными окружения при старте сервиса; ключ хранится локально в state.json (вне git). По умолчанию - локальный Ollama."
          presets={LIGHTRAG_PRESETS}
          initial={llmModal.initial}
          onSave={async (value) => {
            const body: Record<string, string> = { preset: value.preset, apiKey: value.apiKey };
            if (value.baseUrl) body.baseUrl = value.baseUrl;
            if (value.modelId) body.modelId = value.modelId;
            try {
              const res = await fetch("/api/memory/lightrag/llm", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              const json = (await res.json()) as { error?: string };
              return res.ok ? null : json.error ?? "не удалось сохранить";
            } catch {
              return "не удалось сохранить";
            }
          }}
        />
      ) : null}
    </div>
  );
}
