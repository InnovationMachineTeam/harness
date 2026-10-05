"use client";

import { useState } from "react";
import { StatsPanel } from "@/uikit/components/monitoring/StatsPanel";
import { TasksPanel } from "@/uikit/components/monitoring/TasksPanel";
import { Page, Tabs } from "@/uikit";

type Tab = "tasks" | "stats";

const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "Задачи" },
  { key: "stats", label: "Статистика" },
];

/** Мониторинг: исполнение задач консоли и статистика workflow/AgentPlane. */
export default function MonitoringPage() {
  const [tab, setTab] = useState<Tab>("tasks");
  return (
    <Page
      title="Мониторинг"
      description="Исполнение задач консоли: промты в headless-сессиях, запросы провайдерам и сборки OpenWiki/Graphify. Задачи независимы и выполняются параллельно. Вкладка Статистика - запуски, шаги, роли, токены, стоимость и задачи AgentPlane."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-6 border-b border-line/60 pb-2" />
      {tab === "tasks" ? <TasksPanel /> : null}
      {tab === "stats" ? <StatsPanel /> : null}
    </Page>
  );
}
