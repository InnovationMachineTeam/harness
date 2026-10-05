"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@/uikit";
import type { RuntimeSnapshotDTO } from "@/core/types";
import { AgentPanel } from "@/uikit/components/agent/AgentPanel";
import { RolesPanel } from "@/uikit/components/workflows/RolesPanel";
import { TasksBoard } from "@/uikit/components/workflows/TasksBoard";
import { WorkflowStudio } from "@/uikit/components/workflows/WorkflowStudio";

const TABS = [
  { key: "agent", label: "Агент" },
  { key: "tasks", label: "Задачи" },
  { key: "workflow", label: "Workflow" },
  { key: "roles", label: "Роли" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return !!value && TABS.some((tab) => tab.key === value);
}

/**
 * Раздел "Агент": четыре вкладки (диалог, Задачи, Workflow, Роли).
 * Открытые вкладки остаются смонтированными скрытыми - состояние диалога
 * и несохранённые правки editor'ов не теряются при переключении. Активная
 * вкладка синхронизируется с ?tab= адреса.
 */
export function AgentWorkspace({ runtimes }: { runtimes: RuntimeSnapshotDTO[] }) {
  const [tab, setTab] = useState<TabKey>("agent");
  const [visited, setVisited] = useState<Record<TabKey, boolean>>({ agent: true, tasks: false, workflow: false, roles: false });

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (isTabKey(fromUrl)) {
      setTab(fromUrl);
      setVisited((old) => ({ ...old, [fromUrl]: true }));
    }
  }, []);

  const change = (key: TabKey) => {
    setTab(key);
    setVisited((old) => (old[key] ? old : { ...old, [key]: true }));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  };

  const pane = (key: TabKey, content: ReactNode) => (
    <div key={key} className={key === tab ? "" : "hidden"}>{visited[key] ? content : null}</div>
  );

  return (
    <div className="space-y-4">
      <Tabs tabs={TABS} active={tab} onChange={change} />
      {pane("agent", <AgentPanel runtimes={runtimes} />)}
      {pane("tasks", <TasksBoard embedded />)}
      {pane("workflow", <WorkflowStudio />)}
      {pane("roles", <RolesPanel />)}
    </div>
  );
}
