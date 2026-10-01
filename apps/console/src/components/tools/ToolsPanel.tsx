"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, Settings2, Stethoscope } from "lucide-react";
import type { ToolStatusDTO } from "@/core/tools";
import { GRAPHIFY_PRESETS, OPENWIKI_PRESETS, type LlmPreset } from "@/core/llmPresets";
import { InstallTerminal } from "@/components/skillsSh/InstallTerminal";
import { ToolInstallModal } from "@/components/tools/ToolInstallModal";
import { LlmSettingsModal, type LlmSettingsValue } from "@/components/tools/LlmSettingsModal";
import { Button, Chip, confirmDialog, IconButton, Loading, Modal, Notice, Panel, SectionLabel, Select, Toggle } from "@/ui/UIKit";

interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
  critical: boolean;
}

interface ToolDiagnostic {
  toolId: string;
  ok: boolean;
  checks: DiagnosticCheck[];
  prompt: string | null;
}

/** У инструмента есть инициализация проекта (serena/codegraph/graphify). */
function hasProjectInit(tool: ToolStatusDTO): boolean {
  return ["serena", "codegraph", "graphify"].includes(tool.id);
}

/**
 * Точка-индикатор дашборда: зелёная пульсирующая - сервис и дашборд работают;
 * жёлтая пульсирующая - наш инстанс запущен, но порт дашборда не принимает соединения;
 * красная - дашборд недоступен (сервис не запущен).
 */
function DashDot({ live, managedPid, className }: { live: boolean; managedPid: number | null; className?: string }) {
  const tone = live ? "bg-accent" : managedPid ? "bg-warning" : "bg-danger";
  const pulse = live || managedPid ? "animate-pulse" : "";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone} ${pulse} ${className ?? ""}`} />;
}

interface ToolsData {
  tools: ToolStatusDTO[];
  packageManager: "bun" | "npm";
}

interface UsageData {
  events: { tool: string; action: string; at: string; runtimes?: string[] }[];
  aggregates: Record<string, { total: number; lastAt: string | null; byAction: Record<string, number> }>;
  snapshots: { tool: string; source: string; at: string; payload: Record<string, unknown> | null }[];
}

const STATE_CHIP: Record<ToolStatusDTO["state"], { tone: "emerald" | "amber" | "dashed"; label: string }> = {
  on: { tone: "emerald", label: "включён" },
  off: { tone: "amber", label: "выключен" },
  missing: { tone: "dashed", label: "не установлен" },
};

/**
 * Раздел "Инструменты" (Настройки): жизненный цикл инструментов экономии
 * контекста - установка/вкл-выкл/переустановка/удаление, выбор менеджера
 * пакетов и сводка статистики использования.
 */
export function ToolsPanel() {
  const [data, setData] = useState<ToolsData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installTool, setInstallTool] = useState<ToolStatusDTO | null>(null);
  const [job, setJob] = useState<{ toolId: string; action: string; jobId: string } | null>(null);
  const [dashboard, setDashboard] = useState<ToolStatusDTO | null>(null);
  const [dashExpanded, setDashExpanded] = useState(false);
  const [dashNotice, setDashNotice] = useState<string | null>(null);
  const [dashBusy, setDashBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ tool: ToolStatusDTO; result: ToolDiagnostic } | null>(null);
  const [diagBusy, setDiagBusy] = useState<string | null>(null);
  const [fixNotice, setFixNotice] = useState<string | null>(null);
  const [jobFailed, setJobFailed] = useState(false);
  const [fixJobBusy, setFixJobBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [graphEmbed, setGraphEmbed] = useState<{ label: string; src: string } | null>(null);
  const [llmModal, setLlmModal] = useState<{
    tool: ToolStatusDTO;
    presets: LlmPreset[];
    initial: LlmSettingsValue;
    getUrl: string;
  } | null>(null);

  /** Промпт headless-исправления провалившегося job'а (init/clone/install). */
  function jobFixPrompt(toolId: string, action: string): string {
    const tool = data?.tools.find((t) => t.id === toolId);
    const commands =
      tool?.projectInit?.initCommands.map((c) => c.join(" ")).join("; ") ??
      tool?.system.installCommand?.join(" ") ??
      "см. docs/tools.md";
    const title = tool?.title ?? toolId;
    return [
      `Исправь ${action === "init" ? "инициализацию" : action === "clone" ? "клонирование" : "установку"} инструмента ${title} (${toolId}) в корне этого репозитория.`,
      "",
      "Команды (выполняй по очереди, литерально, без оболочки):",
      commands,
      "",
      "Правила:",
      "- отвечай на интерактивные вопросы установщика сам (y/n);",
      "- graphify: без LLM-ключа используй --code-only (локальный AST);",
      "- если нужна учётная запись/ключ, которых нет - остановись и сообщи пользователю,",
      "  что именно он должен предоставить.",
      "",
      "Соблюдай AGENTS.md и guard.",
    ].join("\n");
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools", { cache: "no-store" });
      setData((await res.json()) as ToolsData);
    } catch {
      setError("не удалось загрузить инструменты");
    }
  }, []);

  // пока модалка дашборда открыта и инстанс не запущен - опрашиваем статус
  const dashWaiting = dashboard !== null && dashboard.dashboard !== undefined && !dashboard.dashboard.live;
  const dashPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!dashWaiting) {
      if (dashPoll.current) clearInterval(dashPoll.current);
      dashPoll.current = null;
      return;
    }
    dashPoll.current = setInterval(() => void load(), 2000);
    return () => {
      if (dashPoll.current) clearInterval(dashPoll.current);
      dashPoll.current = null;
    };
  }, [dashWaiting, load]);

  const dashAction = async (tool: ToolStatusDTO, action: "start" | "stop") => {
    setDashBusy(true);
    setDashNotice(null);
    try {
      const res = await fetch("/api/tools/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: tool.id, action }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      setDashNotice(json.detail ?? json.error ?? null);
      await load();
    } catch {
      setDashNotice("не удалось выполнить действие");
    } finally {
      setDashBusy(false);
    }
  };

  const runDiagnostics = async (tool: ToolStatusDTO) => {
    setDiagBusy(tool.id);
    setFixNotice(null);
    try {
      const res = await fetch("/api/tools/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: tool.id }),
      });
      const json = (await res.json()) as ToolDiagnostic & { error?: string };
      if (!res.ok) setError(json.error ?? "диагностика не удалась");
      else setDiagnostic({ tool, result: json });
    } catch {
      setError("диагностика не удалась");
    } finally {
      setDiagBusy(null);
    }
  };

  const runInit = async (tool: ToolStatusDTO, reinit: boolean) => {
    setBusy(`${tool.id}:init`);
    setError(null);
    try {
      const res = await fetch("/api/tools/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init", toolId: tool.id, reinit, params: { scope: "project" } }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) setError(json.error ?? "не удалось запустить инициализацию");
      else if (json.jobId) setJob({ toolId: tool.id, action: reinit ? "reinit" : "init", jobId: json.jobId });
    } catch {
      setError("не удалось запустить инициализацию");
    } finally {
      setBusy(null);
    }
  };

  const fixViaPrompt = async (prompt: string) => {
    setFixNotice(null);
    try {
      const res = await fetch("/api/prompts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = (await res.json()) as { runtime?: string; error?: string };
      setFixNotice(
        res.ok
          ? `исправление запущено (рантайм: ${json.runtime ?? "★"}); сессия появится на странице рантайма`
          : json.error ?? "не удалось запустить исправление",
      );
    } catch {
      setFixNotice("не удалось запустить исправление");
    }
  };

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/tools/usage", { cache: "no-store" });
      setUsage((await res.json()) as UsageData);
    } catch {
      /* статистика не критична */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadUsage();
  }, [load, loadUsage]);

  const setPm = async (pm: "bun" | "npm") => {
    await fetch("/api/tools", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageManager: pm }),
    });
    await load();
  };

  const setAutostart = async (toolId: string, enabled: boolean) => {
    // оптимистично: чип статуса и доступность последуют после перезагрузки
    setData((prev) =>
      prev
        ? {
            ...prev,
            tools: prev.tools.map((t) =>
              t.id === toolId && t.dashboard ? { ...t, dashboard: { ...t.dashboard, autostart: enabled } } : t,
            ),
          }
        : prev,
    );
    setError(null);
    try {
      const res = await fetch("/api/tools/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId, action: "autostart", enabled }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setError(json.error ?? "не удалось изменить автозапуск");
      else setDashNotice(json.detail ?? null);
    } catch {
      setError("не удалось изменить автозапуск");
    } finally {
      await load();
    }
  };

  /** Открыть граф Graphify в модалке (iframe embed из Memory-публикации). */
  const openGraphEmbed = async () => {
    setError(null);
    try {
      const res = await fetch("/api/memory/graphify", { cache: "no-store" });
      const json = (await res.json()) as {
        folders?: { name: string; enabled: boolean; published: { exists: boolean; slug: string } }[];
      };
      const published = (json.folders ?? []).find((f) => f.enabled && f.published.exists);
      if (!published) {
        setError(
          "Опубликованного графа нет - вкладка \"Память → Graphify\": \"Собрать\" и \"Опубликовать\" (данные появятся и здесь).",
        );
        return;
      }
      setGraphEmbed({
        label: `Граф знаний · ${published.name}`,
        src: `/graphify/${published.published.slug}/index.html`,
      });
    } catch {
      setError("не удалось загрузить графы");
    }
  };

  const runAction = async (
    tool: ToolStatusDTO,
    action: "uninstall" | "reinstall" | "toggle",
    opts: { enabled?: boolean; confirm?: { title: string; body: string } } = {},
  ) => {
    if (opts.confirm && !(await confirmDialog(opts.confirm))) return;
    setBusy(`${tool.id}:${action}`);
    setError(null);
    try {
      const res = await fetch("/api/tools/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, toolId: tool.id, enabled: opts.enabled }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) setError(json.error ?? `не удалось: ${action}`);
      else if (json.jobId) setJob({ toolId: tool.id, action, jobId: json.jobId });
      else await load();
    } catch {
      setError(`не удалось: ${action}`);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Loading />;

  return (
    <div className="space-y-3">
      <Panel
        title="Инструменты экономии контекста"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-faint">менеджер npm-пакетов</span>
            <Select
              value={data.packageManager}
              onChange={(pm) => void setPm(pm as "bun" | "npm")}
              options={[
                { value: "bun", label: "Bun (bun add -g / bunx)" },
                { value: "npm", label: "NPM (npm install -g / npx)" },
              ]}
              ariaLabel="менеджер пакетов"
            />
          </div>
        }
      >
        <p className="text-[11px] leading-relaxed text-fg-faint">
          Установка по умолчанию охватывает все поддерживаемые рантаймы. Выключение снимает интеграцию, оставляя
          системный пакет; удаление убирает интеграцию и MCP-запись (пакет удаляйте вручную). Агенты вызывают
          инструменты через{" "}
          <span className="font-mono">tooling/scripts/tool.sh</span> - состояние читается из{" "}
          <span className="font-mono">.agents/console/tools.env</span>.
        </p>
        {error ? <div className="mt-2"><Notice tone="error">{error}</Notice></div> : null}
        {dashNotice ? <div className="mt-2"><Notice tone="info">{dashNotice}</Notice></div> : null}
      </Panel>

      {data.tools.map((tool) => {
        const state = STATE_CHIP[tool.state];
        return (
          <Panel
            as="article"
            key={tool.id}
            title={tool.title}
            actions={
              <>
                {tool.mcp?.registered ? (
                  <Chip tone={tool.mcp.enabled ? "sky" : "dim"}>MCP {tool.mcp.enabled ? "вкл" : "выкл"}</Chip>
                ) : null}
                <Chip tone={state.tone}>{state.label}</Chip>
                {tool.system.version ? <Chip tone="muted" mono>{tool.system.version}</Chip> : null}
                {!tool.system.installed ? <Chip tone="red">CLI не установлен</Chip> : null}
              </>
            }
          >
            <p className="mb-2 text-[11px] leading-relaxed text-fg-faint">{tool.description}</p>
            {tool.perRuntime ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {tool.perRuntime.supported.map((r) => (
                  <Chip key={r.id} tone={r.installed ? "emerald" : "neutral"} title={r.note}>
                    {r.id}
                    {r.installed ? " ✓" : ""}
                  </Chip>
                ))}
                {tool.perRuntime.unsupported.map((r) => (
                  <Chip key={r.id} tone="dashed" title={r.note ?? "не поддерживается"}>
                    {r.id}
                  </Chip>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {tool.state === "missing" ? (
                  <Button size="xs" variant="accent" onClick={() => setInstallTool(tool)}>
                    Установить
                  </Button>
                ) : (
                  <>
                    <Button
                      size="xs"
                      variant={tool.state === "on" ? "neutral" : "accent"}
                      disabled={busy !== null}
                      onClick={() => void runAction(tool, "toggle", { enabled: tool.state !== "on" })}
                    >
                      {tool.state === "on" ? "Выключить" : "Включить"}
                    </Button>
                    <Button
                      size="xs"
                      variant="neutral"
                      disabled={busy !== null || !tool.installedRecord}
                      title={tool.installedRecord ? undefined : "установите через консоль, чтобы включить переустановку"}
                      onClick={() =>
                        void runAction(tool, "reinstall", {
                          confirm: {
                            title: `Переустановить ${tool.title}?`,
                            body: "Интеграция будет снята и поставлена заново (сохранённые рантаймы и параметры).",
                          },
                        })
                      }
                    >
                      Переустановить
                    </Button>
                    <Button
                      size="xs"
                      variant="warning"
                      disabled={busy !== null}
                      onClick={() =>
                        void runAction(tool, "uninstall", {
                          confirm: {
                            title: `Удалить ${tool.title}?`,
                            body: `Интеграции и MCP-запись будут сняты. Системный пакет остаётся${
                              tool.system.installCommand
                                ? ` (полная очистка вручную: ${tool.system.installCommand.join(" ").replace("install", "uninstall")})`
                                : ""
                            }.`,
                          },
                        })
                      }
                    >
                      Удалить
                    </Button>
                  </>
                )}
                {tool.dashboard ? (
                  <Button size="xs" variant="ghostDim" onClick={() => setDashboard(tool)}>
                    <DashDot live={tool.dashboard.live} managedPid={tool.dashboard.managedPid} />
                    {tool.dashboard.label}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghostDim"
                  disabled={diagBusy !== null}
                  onClick={() => void runDiagnostics(tool)}
                  title="Проверить, что инструмент работает"
                >
                  <Stethoscope size={12} />
                  Диагностика
                </Button>
                {tool.id === "graphify" ? (
                  <Button
                    size="xs"
                    variant="ghostDim"
                    onClick={() => void openGraphEmbed()}
                    title="Открыть опубликованный граф знаний (iframe, как дашборды)"
                  >
                    Граф знаний
                  </Button>
                ) : null}
                {tool.id === "openwiki" || tool.id === "graphify" ? (
                  <IconButton
                    icon={Settings2}
                    label="Настроить LLM-провайдера"
                    variant="ghostDim"
                    onClick={() => {
                      const url =
                        tool.id === "openwiki" ? "/api/memory/openwiki/llm" : "/api/memory/graphify/llm";
                      const presets = tool.id === "openwiki" ? OPENWIKI_PRESETS : GRAPHIFY_PRESETS;
                      void (async () => {
                        try {
                          const res = await fetch(url, { cache: "no-store" });
                          const json = (await res.json()) as { llm?: LlmSettingsValue };
                          setLlmModal({
                            tool,
                            presets,
                            initial: json.llm ?? {
                              preset: presets[0].id,
                              apiKey: "",
                              baseUrl: "",
                              modelId: "",
                            },
                            getUrl: url,
                          });
                        } catch {
                          setError("не удалось загрузить LLM-настройки");
                        }
                      })();
                    }}
                  />
                ) : null}
                {hasProjectInit(tool) && tool.projectInit && !tool.projectInit.initialized ? (
                  <Button
                    size="xs"
                    variant="accent"
                    disabled={busy !== null}
                    title={`Проиндексировать все рабочие папки: ${tool.projectInit.dirs.map((d) => d.dir).join(", ") || "-"}`}
                    onClick={() => void runInit(tool, false)}
                  >
                    Инициализировать
                  </Button>
                ) : null}
                {hasProjectInit(tool) && tool.projectInit?.initialized && tool.projectInit.reinitCommands.length > 0 ? (
                  <Button
                    size="xs"
                    variant="ghostDim"
                    disabled={busy !== null}
                    title={(() => {
                      const commands = tool.projectInit.reinitCommands.map((c) => c.join(" ")).join("; ");
                      return `Пересобрать индекс/граф во всех рабочих папках: ${commands}`;
                    })()}
                    onClick={() => void runInit(tool, true)}
                  >
                    Переинициализировать
                  </Button>
                ) : null}
                {tool.docsUrl ? (
                  <a
                    href={tool.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-fg-faint underline decoration-dotted hover:text-fg-muted"
                  >
                    документация
                  </a>
                ) : null}
              </div>
              {tool.dashboard ? (
                <span className="flex items-center gap-2 text-[11px] text-fg-faint">
                  Автозапуск
                  <Toggle
                    size="sm"
                    checked={tool.dashboard.autostart}
                    onChange={(v) => void setAutostart(tool.id, v)}
                    title="Консоль поддерживает автономный инстанс запущенным (запускает при включении и при загрузке инструментов)"
                    ariaLabel={`Автозапуск ${tool.title}`}
                  />
                </span>
              ) : null}
            </div>
          </Panel>
        );
      })}

      {usage ? (
        <Panel title="Статистика использования">
          {Object.keys(usage.aggregates).length === 0 ? (
            <p className="text-xs text-fg-faint">Событий пока нет - файл .agents/console/tools-usage.json.</p>
          ) : (
            <div className="space-y-1">
              {Object.entries(usage.aggregates).map(([toolId, agg]) => {
                const snapshot = usage.snapshots.find((s) => s.tool === toolId);
                return (
                  <div key={toolId} className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                    <span className="w-20 font-medium text-fg-muted">{toolId}</span>
                    <Chip tone="muted">{agg.total} соб.</Chip>
                    {Object.entries(agg.byAction).map(([action, n]) => (
                      <Chip key={action} tone="dim">
                        {action} × {n}
                      </Chip>
                    ))}
                    {agg.lastAt ? (
                      <span className="text-fg-faint">последнее: {new Date(agg.lastAt).toLocaleString("ru-RU")}</span>
                    ) : null}
                    {snapshot ? (
                      <span className="text-fg-faint">
                        метрика ({snapshot.source}): {new Date(snapshot.at).toLocaleString("ru-RU")}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              <SectionLabel>события</SectionLabel>
              {usage.events.slice(-8).reverse().map((e, i) => (
                <p key={i} className="font-mono text-[10px] text-fg-faint">
                  {e.at} {e.tool} {e.action}
                  {e.runtimes?.length ? ` [${e.runtimes.join(",")}]` : ""}
                </p>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      <ToolInstallModal
        tool={installTool}
        open={installTool !== null}
        packageManager={data.packageManager}
        onClose={() => setInstallTool(null)}
        onStarted={(jobId) => {
          setInstallTool(null);
          setJob({ toolId: installTool?.id ?? "", action: "install", jobId });
        }}
      />

      {job ? (
        <Modal
          open
          onClose={() => {
            setJob(null);
            setJobFailed(false);
          }}
          title={`Инструмент · ${job.toolId} (${job.action})`}
          width="max-w-2xl"
        >
          <div className="space-y-3">
            <InstallTerminal
              jobId={job.jobId}
              streamUrl={`/api/tools/job?jobId=${encodeURIComponent(job.jobId)}`}
              inputUrl="/api/tools/job/input"
              onDone={(exitCode) => {
                setJobFailed(exitCode !== null && exitCode !== 0);
                void load();
                void loadUsage();
              }}
            />
            {jobFailed ? (
              <div className="space-y-2">
                <Notice tone="error">Job завершился с ошибкой - можно поручить исправление headless-рантайму.</Notice>
                <Button
                  size="sm"
                  variant="accent"
                  disabled={fixJobBusy}
                  onClick={() => {
                    setFixJobBusy(true);
                    void fixViaPrompt(jobFixPrompt(job.toolId, job.action)).finally(() => setFixJobBusy(false));
                  }}
                >
                  {fixJobBusy ? "Запуск…" : "Исправить (headless-рантайм)"}
                </Button>
                {fixNotice ? <span className="text-[11px] text-fg-muted">{fixNotice}</span> : null}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {dashboard?.dashboard ? (
        <Modal
          open
          onClose={() => {
            setDashboard(null);
            setDashExpanded(false);
          }}
          fullscreen={dashExpanded}
          width="max-w-4xl"
          title={
            <span className="flex items-center gap-2">
              <DashDot live={dashboard.dashboard.live} managedPid={dashboard.dashboard.managedPid} />
              {dashboard.dashboard.label}
            </span>
          }
          headerActions={
            <>
              <IconButton
                icon={ExternalLink}
                label="Открыть в новой вкладке"
                href={dashboard.dashboard.url}
                variant="neutral"
                className="rounded-full"
              />
              <IconButton
                icon={dashExpanded ? Minimize2 : Maximize2}
                label={dashExpanded ? "Свернуть" : "Развернуть на весь экран"}
                variant="neutral"
                onClick={() => setDashExpanded((v) => !v)}
                className="rounded-full"
              />
            </>
          }
        >
          <div className="space-y-3">
            {dashNotice && !dashboard.dashboard.live ? <Notice tone="info">{dashNotice}</Notice> : null}
            {dashboard.dashboard.live ? (
              <>
                <iframe
                  key={`dash-${dashboard.id}-${String(dashboard.dashboard.live)}`}
                  src={dashboard.dashboard.embedPath ?? dashboard.dashboard.url}
                  title={dashboard.dashboard.label}
                  sandbox="allow-scripts allow-same-origin"
                  className={
                    dashExpanded
                      ? "h-[calc(94vh-12rem)] w-full rounded-lg border border-line"
                      : "h-[60vh] w-full rounded-lg border border-line"
                  }
                />
                <div className="flex items-center justify-between">
                  <Chip tone="emerald">порт принимает соединения</Chip>
                  {dashboard.dashboard.managedPid ? (
                    <Button
                      size="xs"
                      variant="warning"
                      disabled={dashBusy}
                      onClick={() => void dashAction(dashboard, "stop")}
                    >
                      Остановить инстанс
                    </Button>
                  ) : (
                    <span className="text-[11px] text-fg-faint">
                      запущен вне консоли (сессия агента) - останется жить после закрытия модалки
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Button size="sm" variant="accent" disabled={dashBusy} onClick={() => void dashAction(dashboard, "start")}>
                  {dashBusy ? "Запуск…" : "Запустить автономный инстанс"}
                </Button>
                {dashWaiting ? (
                  <p className="text-[11px] text-fg-faint">порт запускается… (опрос раз в 2 с)</p>
                ) : null}
              </div>
            )}
          </div>
        </Modal>
      ) : null}

      {graphEmbed ? (
        <Modal
          open
          onClose={() => setGraphEmbed(null)}
          fullscreen
          width="max-w-4xl"
          title={
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent animate-pulse" />
              {graphEmbed.label}
            </span>
          }
          headerActions={
            <a href={graphEmbed.src} target="_blank" rel="noreferrer">
              <IconButton icon={ExternalLink} label="Открыть в новой вкладке" variant="neutral" className="rounded-full" />
            </a>
          }
        >
          <iframe
            src={graphEmbed.src}
            title={graphEmbed.label}
            sandbox="allow-scripts allow-same-origin"
            className="h-[calc(94vh-12rem)] w-full rounded-lg border border-line"
          />
        </Modal>
      ) : null}

      {llmModal ? (
        <LlmSettingsModal
          open
          onClose={() => setLlmModal(null)}
          title={`LLM-провайдер · ${llmModal.tool.title}`}
          description="Провайдер передаётся инструменту переменными окружения при сборке; ключ хранится локально в state.json (вне git)."
          presets={llmModal.presets}
          initial={llmModal.initial}
          onSave={async (value) => {
            const body: Record<string, string> = { preset: value.preset, apiKey: value.apiKey };
            if (value.baseUrl) body.baseUrl = value.baseUrl;
            if (value.modelId) body.modelId = value.modelId;
            try {
              const res = await fetch(llmModal.getUrl, {
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

      {diagnostic ? (
        <Modal
          open
          onClose={() => setDiagnostic(null)}
          title={`Диагностика · ${diagnostic.tool.title}`}
          width="max-w-2xl"
        >
          <div className="space-y-3">
            {diagnostic.result.ok ? (
              <Notice tone="success">Все проверки пройдены - инструмент работает.</Notice>
            ) : (
              <Notice tone="error">
                Проблемы: {diagnostic.result.checks.filter((c) => !c.ok).length} - можно исправить через
                headless-рантайм.
              </Notice>
            )}
            <ul className="space-y-1.5">
              {diagnostic.result.checks.map((check) => (
                <li key={check.name} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <span
                    className={
                      check.ok ? "text-accent" : check.critical ? "text-danger" : "text-warning"
                    }
                  >
                    {check.ok ? "✓" : check.critical ? "✗" : "-"}
                  </span>
                  <span>
                    <span className="font-medium text-fg-muted">{check.name}</span>
                    <span className="text-fg-faint"> - {check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {diagnostic.result.prompt ? (
              <div className="space-y-2">
                <details>
                  <summary className="cursor-pointer text-[11px] text-fg-muted">промпт исправления</summary>
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-page p-2.5 font-mono text-[10px] leading-relaxed text-fg-faint">
                    {diagnostic.result.prompt}
                  </pre>
                </details>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => void fixViaPrompt(diagnostic.result.prompt!)}
                  >
                    Исправить (headless-рантайм)
                  </Button>
                  {fixNotice ? <span className="text-[11px] text-fg-muted">{fixNotice}</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
