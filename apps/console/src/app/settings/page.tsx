"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DesignPanel } from "@/components/design/DesignPanel";
import { ToolsPanel } from "@/components/tools/ToolsPanel";
import { useConsoleStore, type TaskRuntimes } from "@/store/console";
import { Panel, Page, Select, Tabs } from "@/ui/UIKit";

const TASKS: { key: keyof TaskRuntimes; title: string; description: string }[] = [
  {
    key: "promptExecution",
    title: "Исполнение команд",
    description: "Рантайм для запуска промтов: кнопка \"Исправить\" в диагностике и POST /api/prompts/run.",
  },
  {
    key: "skillCreation",
    title: "Создание навыка",
    description: "Рантайм, которому консоль поручает создавать новые навыки по форме на вкладке \"Навыки\".",
  },
];

type Tab = "general" | "design" | "tools";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "Основные" },
  { key: "design", label: "Design" },
  { key: "tools", label: "Инструменты" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  const taskRuntimes = useConsoleStore((s) => s.taskRuntimes);
  const defaultRuntime = useConsoleStore((s) => s.defaultRuntime);
  const runtimes = useConsoleStore((s) => s.runtimes);
  const hydrate = useConsoleStore((s) => s.hydrate);
  const hydrated = useConsoleStore((s) => s.hydrated);
  const save = useConsoleStore((s) => s.saveTaskRuntimes);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  const setTask = (task: keyof TaskRuntimes, value: string) => {
    if (!taskRuntimes) return;
    void save({ ...taskRuntimes, [task]: value === "default" ? null : value });
  };

  return (
    <Page
      title="Настройки"
      description={
        tab === "general" ? (
          <>
            Рантайм под конкретную задачу. Значение "По умолчанию" берёт рантайм, выбранный звездой ★ в harness
            {defaultRuntime ? ` (сейчас: ${defaultRuntime})` : " (пока не выбран)"}.
          </>
        ) : tab === "design" ? (
          <>Темы консоли: пресеты, настройка в реальном времени и файлы DESIGN.md / DESIGN.light.md в корне репозитория.</>
        ) : (
          <>Жизненный цикл инструментов экономии контекста и статистика их использования.</>
        )
      }
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-6 border-b border-line/60 pb-2" />

      {tab === "general" ? (
        <>
          <div className="space-y-3">
            {TASKS.map((task) => (
              <Panel key={task.key} as="article" title={task.title}>
                <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">{task.description}</p>
                <Select
                  value={taskRuntimes?.[task.key] ?? "default"}
                  onChange={(value) => setTask(task.key, value)}
                  disabled={!taskRuntimes}
                  size="md"
                  className="w-full max-w-sm"
                  ariaLabel={`рантайм задачи "${task.title}"`}
                  options={[
                    {
                      value: "default",
                      label: `По умолчанию ${defaultRuntime ? `(★ ${defaultRuntime})` : "(★ не выбран)"}`,
                    },
                    ...(runtimes ?? []).map((runtime) => ({
                      value: runtime.id,
                      label: runtime.displayName + (runtime.hasAdapter ? "" : " (без адаптера)"),
                    })),
                  ]}
                />
                {taskRuntimes?.[task.key] ? (
                  <p className="mt-2 text-[11px] text-warning">
                    назначен {taskRuntimes[task.key]} - перекрывает рантайм по умолчанию для этой задачи
                  </p>
                ) : null}
              </Panel>
            ))}
          </div>

          <p className="mt-6 text-[11px] text-fg-faint">
            Все настройки хранятся в{" "}
            <span className="font-mono">.agents/console/state.json</span> на сервере и кешируются; UI-параметры (окно
            недавности, авто-refresh) - в localStorage через zustand. Рантайм по умолчанию (★) выбирается на{" "}
            <Link href="/" className="underline decoration-dotted hover:text-fg-muted">
              странице рантаймов
            </Link>
            .
          </p>
        </>
      ) : tab === "design" ? (
        <DesignPanel />
      ) : (
        <ToolsPanel />
      )}
    </Page>
  );
}
