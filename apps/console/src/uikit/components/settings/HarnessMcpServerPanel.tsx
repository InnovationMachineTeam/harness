"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Input, Notice, Panel, Toggle } from "@/uikit";

/** Группы инструментов: ключ конфига + подпись карточки. */
const GROUPS: Array<{ key: string; label: string; hint: string }> = [
  { key: "prompts", label: "Промты", hint: "запуск промта в headless-сессии рантайма или провайдера" },
  { key: "workflows", label: "Workflow", hint: "каталог, запуск, статусы, события и операторские действия прогонов" },
  { key: "routines", label: "Рутины", hint: "создание, правка, удаление и внеплановый запуск" },
  { key: "catalog", label: "Каталог папок", hint: "рабочие папки, роли, навыки, slash-меню" },
  { key: "sessions", label: "Сессии", hint: "список, полнотекстовый поиск, ответ в сессию" },
  { key: "monitoring", label: "Мониторинг", hint: "задачи и процессы консоли; stop_process - отдельным флагом" },
  { key: "knowledge", label: "Знания", hint: "уроки, roadmap, спринты, статистика, чтение файлов памяти" },
];

interface HarnessMcpState {
  config: {
    workspaces: "all" | string[];
    groups: Record<string, boolean>;
    monitoring: { stopProcesses: boolean };
    workflowTools: { enabled: boolean; workflows: "all" | string[] };
  };
  http: { enabled: boolean; token: string };
  registration: { stdio: boolean; http: boolean };
  workspaces: string[];
}

/**
 * Панель "Собственный сервер harness" (Настройки - MCP): состав инструментов,
 * экспонируемые рабочие папки, динамические workflow-инструменты и регистрация
 * транспорта (stdio для рантаймов, HTTP endpoint консоли с Bearer-токеном).
 * Конфиг хранится в .agents/console/mcp-server.json и применяется при новом
 * соединении с сервером.
 */
export function HarnessMcpServerPanel({ className }: { className?: string }) {
  const [state, setState] = useState<HarnessMcpState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-server", { cache: "no-store" });
      const json = (await res.json()) as HarnessMcpState;
      setState(json);
    } catch {
      setError("не удалось загрузить состояние сервера");
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  const save = async (patch: { config?: unknown; stdio?: boolean; http?: { enabled: boolean; regenerateToken?: boolean } }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp-server", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as HarnessMcpState & { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setState(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = (key: string, value: boolean) => {
    if (!state) return;
    void save({
      config: { ...state.config, groups: { ...state.config.groups, [key]: value } },
    });
  };

  const exposed = useMemo(() => {
    if (!state) return new Set<string>();
    return new Set(state.config.workspaces === "all" ? (state.workspaces ?? []) : state.config.workspaces);
  }, [state]);

  const toggleWorkspace = (dir: string, value: boolean) => {
    if (!state) return;
    const next = new Set(exposed);
    if (value) next.add(dir);
    else next.delete(dir);
    const all = (state.workspaces ?? []).every((candidate) => next.has(candidate));
    void save({
      config: { ...state.config, workspaces: all || next.size === 0 ? "all" : [...next] },
    });
  };

  return (
    <section
      className={`rounded-lg border border-line bg-page/40 p-3 ${className ?? ""}`}
      aria-label="собственный MCP-сервер harness"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-fg">Собственный сервер harness</h3>
        {state?.registration.stdio ? <Chip tone="emerald">stdio зарегистрирован</Chip> : <Chip tone="muted">stdio не в реестре</Chip>}
        {state?.http.enabled ? <Chip tone="emerald">HTTP включён</Chip> : <Chip tone="muted">HTTP выключен</Chip>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="xs"
            variant={state?.registration.stdio ? "ghostDim" : "primary"}
            disabled={busy}
            onClick={() => void save({ stdio: !state?.registration.stdio })}
          >
            {state?.registration.stdio ? "Снять stdio-запись" : "Зарегистрировать stdio"}
          </Button>
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Собственные возможности платформы как MCP-инструменты (mcp__harness__*): запуск промтов и workflow, рутины,
        каталог рабочих папок, сессии, мониторинг, знания. Состав настраивается ниже; workflow экспонированных папок
        доступны как отдельные инструменты workflow_&lt;id&gt;. Конфиг: <span className="font-mono">.agents/console/mcp-server.json</span>.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!state ? (
        <p className="text-xs text-fg-faint">Загрузка…</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((group) => (
              <label key={group.key} className="flex items-start gap-2 rounded border border-line bg-page/60 p-2" title={group.hint}>
                <Toggle
                  checked={Boolean(state.config.groups[group.key])}
                  onChange={(value) => toggleGroup(group.key, value)}
                  disabled={busy}
                  ariaLabel={`группа инструментов ${group.label}`}
                />
                <span className="text-xs leading-tight text-fg">
                  {group.label}
                  <span className="block text-[10px] text-fg-faint">{group.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {state.config.groups.monitoring ? (
            <label className="flex items-center gap-2 text-xs text-fg">
              <Toggle
                checked={state.config.monitoring.stopProcesses}
                onChange={(value) => void save({ config: { ...state.config, monitoring: { stopProcesses: value } } })}
                disabled={busy}
                ariaLabel="разрешить остановку процессов"
              />
              Инструмент stop_process (останавливает процессы по PID; действие деструктивно)
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-xs text-fg">
            <Toggle
              checked={state.config.workflowTools.enabled}
              onChange={(value) => void save({ config: { ...state.config, workflowTools: { ...state.config.workflowTools, enabled: value } } })}
              disabled={busy}
              ariaLabel="динамические workflow-инструменты"
            />
            Workflow экспонированных папок как отдельные инструменты (до 30)
          </label>

          <div>
            <p className="mb-1 text-[11px] text-fg-faint">Экспонируемые рабочие папки:</p>
            <div className="flex flex-wrap gap-1.5">
              {(state.workspaces ?? []).map((dir) => (
                <label
                  key={dir}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${exposed.has(dir) ? "border-info bg-info/10 text-info" : "border-line text-fg-faint hover:text-fg"}`}
                  title={dir}
                >
                  <input
                    type="checkbox"
                    checked={exposed.has(dir)}
                    disabled={busy}
                    onChange={(event) => toggleWorkspace(dir, event.target.checked)}
                  />
                  {dir.split("/").pop()}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded border border-line bg-page/60 p-2">
            <div className="flex flex-wrap items-center gap-3">
              <Toggle
                checked={state.http.enabled}
                onChange={(value) => void save({ http: { enabled: value } })}
                disabled={busy}
                ariaLabel="включить HTTP-транспорт"
              />
              <span className="text-xs text-fg-faint">{state.http.enabled ? "endpoint принимает запросы" : "endpoint закрыт (403)"}</span>
              <Button size="xs" disabled={busy || !state.http.token} onClick={() => void save({ http: { enabled: true, regenerateToken: true } })}>
                Сгенерировать токен
              </Button>
            </div>
            {state.http.enabled && state.http.token ? (
              <div className="mt-2 space-y-1.5">
                <Input readOnly value={`${origin}/api/mcp/harness`} className="w-full font-mono text-[11px]" aria-label="адрес MCP endpoint" onFocus={(event) => event.target.select()} />
                <Input readOnly value={`Authorization: Bearer ${state.http.token}`} className="w-full font-mono text-[11px]" aria-label="заголовок авторизации" onFocus={(event) => event.target.select()} />
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-fg-faint">Токен создаётся при включении; регистрация harness-http в реестре выполняется автоматически.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
