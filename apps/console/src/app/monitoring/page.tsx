"use client";

import { useState } from "react";
import { StatsPanel } from "@/uikit/components/monitoring/StatsPanel";
import { TasksPanel } from "@/uikit/components/monitoring/TasksPanel";
import { ProcessesPanel } from "@/uikit/components/monitoring/ProcessesPanel";
import { Page, Tabs } from "@/uikit";

type Tab = "tasks" | "processes" | "stats";

const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "Задачи" },
  { key: "processes", label: "Процессы" },
  { key: "stats", label: "Статистика" },
];

/** Мониторинг: исполнение задач консоли, процессы и статистика workflow/AgentPlane. */
export default function MonitoringPage() {
  const [tab, setTab] = useState<Tab>("tasks");
  return (
    <Page
      title="Мониторинг"
      description="Исполнение задач консоли: промты в headless-сессиях, запросы провайдерам и сборки OpenWiki/Graphify. Задачи независимы и выполняются параллельно. Вкладка Процессы - процессы рантаймов, MCP, провайдеров и инструментов: ресурсы, сортировка, остановка. Вкладка Статистика - запуски, шаги, роли, токены, стоимость и задачи AgentPlane."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-6 border-b border-line/60 pb-2" />
      {tab === "tasks" ? <TasksPanel /> : null}
      {tab === "processes" ? <ProcessesPanel /> : null}
      {tab === "stats" ? <StatsPanel /> : null}
    </Page>
  );
}
