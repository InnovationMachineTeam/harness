"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DesignPanel } from "@/uikit/components/design/DesignPanel";
import { useActiveProviders } from "@/uikit/components/providers/useActiveProviders";
import { AiSdkPanel } from "@/uikit/components/settings/AiSdkPanel";
import { GuardrailsPanel } from "@/uikit/components/settings/GuardrailsPanel";
import { McpSettingsPanel } from "@/uikit/components/settings/McpSettingsPanel";
import { OptimizationPanel } from "@/uikit/components/settings/OptimizationPanel";
import { PluginsPanel } from "@/uikit/components/settings/PluginsPanel";
import { SkillsSettingsPanel } from "@/uikit/components/settings/SkillsSettingsPanel";
import { WorkspacesPanel } from "@/uikit/components/settings/WorkspacesPanel";
import { WorkflowSettingsPanel } from "@/uikit/components/settings/WorkflowSettingsPanel";
import { ToolsPanel } from "@/uikit/components/tools/ToolsPanel";
import { UpdatePanel } from "@/uikit/components/update/UpdatePanel";
import type { ProviderDTO } from "@/core/providers";
import { useConsoleStore, type TaskRuntimes } from "@/store/console";
import { Loading, Panel, Page, Select, Tabs } from "@/uikit";

const TASKS: { key: keyof TaskRuntimes; title: string; description: string }[] = [
  {
    key: "promptExecution",
    title: "Исполнение команд",
    description:
      "Исполнитель для запуска промтов: кнопка \"Исправить\" в диагностике и POST /api/prompts/run. Рантайм запускает headless-CLI; провайдер отправляет промт в его API (ответ - в .agents/console/runs).",
  },
  {
    key: "skillCreation",
    title: "Создание навыка",
    description:
      "Исполнитель, которому консоль поручает создавать новые навыки по форме на вкладке \"Навыки\": рантайм (headless-CLI) или активный провайдер реестра.",
  },
  {
    key: "optimization",
    title: "Оптимизация",
    description:
      "Исполнитель кнопки \"Оптимизировать\" на вкладке \"Оптимизация\" (отчёты Claude Insights и CodeBurn). Значение \"По умолчанию\" - провайдер по умолчанию (Ollama, если не выбран); генерация отчёта всегда идёт через провайдера.",
  },
];

const TOOL_CASES: { id: "openwiki" | "graphify"; title: string; url: string; description: string }[] = [
  {
    id: "openwiki",
    title: "OpenWiki (сборка вики)",
    url: "/api/memory/openwiki/llm",
    description:
      "LLM-провайдер сборки вики OpenWiki для рабочих папок с включённым тогглом. Провайдер реестра подставляет пресет, ключ, base URL и модель (standard); \"Вручную\" - настройки инструментов (шестерёнка в \"Инструментах\").",
  },
  {
    id: "graphify",
    title: "Graphify (сборка графа)",
    url: "/api/memory/graphify/llm",
    description:
      "LLM-бэкенд сборки графа знаний Graphify. Провайдер реестра подставляет пресет и ключ; \"Вручную\" - пресет и ключ в настройках инструментов.",
  },
];

type Tab = "general" | "workflow" | "guardrails" | "design" | "workspaces" | "skills" | "mcp" | "plugins" | "tools" | "optimization" | "update";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "Основные" },
  { key: "workflow", label: "Workflow" },
  { key: "guardrails", label: "Guardrails" },
  { key: "design", label: "Внешний вид" },
  { key: "workspaces", label: "Рабочие папки" },
  { key: "skills", label: "Навыки" },
  { key: "mcp", label: "MCP" },
  { key: "plugins", label: "Плагины" },
  { key: "tools", label: "Инструменты" },
  { key: "optimization", label: "Оптимизация" },
  { key: "update", label: "Обновить" },
];

const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

interface ToolLlmState {
  openwiki?: { providerId?: string };
  graphify?: { providerId?: string };
}

const TAB_DESCRIPTION: Record<Tab, ReactNode> = {
  general: null, // описание рендерится с данными состояния (звезда рантайма)
  workflow: <>Privacy analytics, порядок дизайн-провайдеров и фиксированная стоимость подписки для Статистики.</>,
  guardrails: "Аудит исполняемой политики: правила, тестовые кейсы, runtime hooks, code-интеграции, Husky и CI.",
  design: (
    <>
      Внешний вид самой консоли: темы, пресеты, файлы DESIGN.md / DESIGN.light.md в корне репозитория. Работа с дизайном
      проектов - раздел <Link href="/design">"Дизайн"</Link>.
    </>
  ),
  workspaces:
    "Папки, в которых ведётся работа рантаймами. Минимум одна - обязательная (заменить можно, удалить - нет); остальные добавляются по необходимости. Списки сессий фильтруются по этим папкам. Тогглы OpenWiki/Graphify включают сборку вики и графа знаний для папки (раздел Знание).",
  skills: "Установка из реестра skills.sh (в .agents/skills), создание через рантайм и управление включением установленных навыков.",
  mcp: "Глобальный реестр MCP-серверов: изменения синкаются в локальные файлы всех рантаймов в их форматах.",
  plugins:
    "Плагин - бандл MCP-серверов (и заявленных навыков). Включённый плагин добавляет свои MCP в общий реестр и синк; выключенный - убирает.",
  tools: "Жизненный цикл инструментов экономии контекста и статистика их использования.",
  optimization:
    "Отчёты оптимизации: Claude Insights (срез Claude Code) и CodeBurn (расход токенов по всем рантаймам). Отчёт формирует провайдер; \"Оптимизировать\" запускает выбранные рекомендации у исполнителя из \"Основных\".",
  update:
    "Реестр зависимостей harness: проверка свежих версий локальных пакетов workspace и глобальных инструментов, выбор и запуск обновлений. Реестр хранится в .agents/console/updates.json.",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  const taskRuntimes = useConsoleStore((s) => s.taskRuntimes);
  const defaultRuntime = useConsoleStore((s) => s.defaultRuntime);
  const defaultProvider = useConsoleStore((s) => s.defaultProvider);
  const runtimes = useConsoleStore((s) => s.runtimes);
  const hydrate = useConsoleStore((s) => s.hydrate);
  const hydrated = useConsoleStore((s) => s.hydrated);
  const save = useConsoleStore((s) => s.saveTaskRuntimes);
  const providers = useActiveProviders();
  const [toolLlm, setToolLlm] = useState<ToolLlmState | null>(null);
  const [toolLlmError, setToolLlmError] = useState<string | null>(null);

  // прямые ссылки вида /settings?tab=workspaces (из разделов Знание и Навыков рантайма)
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && TAB_KEYS.has(requested)) setTab(requested as Tab);
  }, []);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  const loadToolLlm = useCallback(async () => {
    try {
      const [openwiki, graphify] = await Promise.all([
        fetch("/api/memory/openwiki/llm", { cache: "no-store" }),
        fetch("/api/memory/graphify/llm", { cache: "no-store" }),
      ]);
      const openwikiJson = openwiki.ok ? ((await openwiki.json()) as { llm?: { providerId?: string } }) : {};
      const graphifyJson = graphify.ok ? ((await graphify.json()) as { llm?: { providerId?: string } }) : {};
      setToolLlm({
        openwiki: { providerId: openwikiJson.llm?.providerId },
        graphify: { providerId: graphifyJson.llm?.providerId },
      });
    } catch {
      setToolLlmError("не удалось загрузить LLM-настройки инструментов");
    }
  }, []);

  useEffect(() => {
    void loadToolLlm();
  }, [loadToolLlm]);

  const setTask = (task: keyof TaskRuntimes, value: string) => {
    if (!taskRuntimes) return;
    void save({ ...taskRuntimes, [task]: value === "default" ? null : value });
  };

  /** Выбор провайдера для инструмента: providerId или "manual" (поля - в настройках инструментов). */
  const setToolProvider = async (toolCase: (typeof TOOL_CASES)[number], value: string) => {
    setToolLlmError(null);
    const body = value === "manual" ? {} : { providerId: value };
    try {
      const res = await fetch(toolCase.url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setToolLlmError(json.error ?? "не удалось сохранить");
        return;
      }
      setToolLlm((prev) => ({ ...prev, [toolCase.id]: { providerId: value === "manual" ? undefined : value } }));
    } catch {
      setToolLlmError("сеть недоступна - настройка не сохранена");
    }
  };

  const providerOptions = (toolKey: "openwiki" | "graphify"): { value: string; label: string }[] => [
    { value: "manual", label: "Вручную (настройки инструментов)" },
    ...providers
      .filter((p: ProviderDTO) => Boolean(p.tools[toolKey]))
      .map((p) => ({ value: p.id, label: `${p.label} (провайдер)` })),
  ];

  const description =
    tab === "general" ? (
      <>
        Исполнитель или LLM-провайдер под конкретную задачу. Значение "По умолчанию" берёт рантайм, выбранный
        звездой ★ в harness{defaultRuntime ? ` (сейчас: ${defaultRuntime})` : " (пока не выбран)"}; провайдеры
        берутся из активных (проверенных) записей вкладки "Провайдеры".
      </>
    ) : (
      TAB_DESCRIPTION[tab]
    );

  return (
    <Page title="Настройки" description={description}>
      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-6 border-b border-line/60 pb-2" />

      {tab === "general" ? (
        <>
          <AiSdkPanel />

          <div className="mt-3 space-y-3">
            {TASKS.map((task) => (
              <Panel key={task.key} as="article" title={task.title}>
                <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">{task.description}</p>
                <Select
                  value={taskRuntimes?.[task.key] ?? "default"}
                  onChange={(value) => setTask(task.key, value)}
                  disabled={!taskRuntimes}
                  size="md"
                  className="w-full max-w-sm"
                  ariaLabel={`исполнитель задачи "${task.title}"`}
                  options={[
                    {
                      value: "default",
                      label:
                        task.key === "optimization"
                          ? `По умолчанию (провайдер: ${defaultProvider ?? "ollama"})`
                          : `По умолчанию ${defaultRuntime ? `(★ ${defaultRuntime})` : "(★ не выбран)"}`,
                    },
                    ...(runtimes ?? []).map((runtime) => ({
                      value: runtime.id,
                      label: runtime.displayName + (runtime.hasAdapter ? "" : " (без адаптера)"),
                    })),
                    ...providers.map((provider) => ({
                      value: `provider:${provider.id}`,
                      label: `${provider.label} (провайдер)`,
                    })),
                  ]}
                />
                {taskRuntimes?.[task.key]?.startsWith("provider:") ? (
                  <p className="mt-2 text-[11px] text-info">
                    назначен провайдер {taskRuntimes[task.key]!.slice("provider:".length)} - промты уходят в его API
                  </p>
                ) : taskRuntimes?.[task.key] ? (
                  <p className="mt-2 text-[11px] text-warning">
                    назначен {taskRuntimes[task.key]} - перекрывает рантайм по умолчанию для этой задачи
                  </p>
                ) : null}
              </Panel>
            ))}

            {TOOL_CASES.map((toolCase) => (
              <Panel key={toolCase.id} as="article" title={toolCase.title}>
                <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">{toolCase.description}</p>
                {toolLlm ? (
                  <Select
                    value={toolLlm[toolCase.id]?.providerId ?? "manual"}
                    onChange={(value) => void setToolProvider(toolCase, value)}
                    size="md"
                    className="w-full max-w-sm"
                    ariaLabel={`провайдер для ${toolCase.title}`}
                    options={providerOptions(toolCase.id)}
                  />
                ) : (
                  <Loading />
                )}
                {toolLlm?.[toolCase.id]?.providerId ? (
                  <p className="mt-2 text-[11px] text-info">
                    настроен провайдером {toolLlm[toolCase.id]!.providerId} - поля пресета/ключа выводятся из его записи
                  </p>
                ) : null}
              </Panel>
            ))}
          </div>

          {toolLlmError ? <p className="mt-3 text-[11px] text-danger">{toolLlmError}</p> : null}

          <p className="mt-6 text-[11px] text-fg-faint">
            Все настройки хранятся в{" "}
            <span className="font-mono">.agents/console/state.json</span> на сервере и кешируются; UI-параметры (окно
            недавности, авто-refresh) - в localStorage через zustand. Рантайм по умолчанию (★) выбирается на{" "}
            <Link href="/runtimes" className="underline decoration-dotted hover:text-fg-muted">
              странице рантаймов
            </Link>
            ; провайдеры - на её внутренней вкладке "Провайдеры".
          </p>
        </>
      ) : tab === "workflow" ? (
        <WorkflowSettingsPanel />
      ) : tab === "guardrails" ? (
        <GuardrailsPanel />
      ) : tab === "design" ? (
        <DesignPanel />
      ) : tab === "workspaces" ? (
        <WorkspacesPanel />
      ) : tab === "skills" ? (
        <SkillsSettingsPanel />
      ) : tab === "mcp" ? (
        <McpSettingsPanel />
      ) : tab === "plugins" ? (
        <PluginsPanel />
      ) : tab === "optimization" ? (
        <OptimizationPanel />
      ) : tab === "update" ? (
        <UpdatePanel />
      ) : (
        <ToolsPanel />
      )}
    </Page>
  );
}
