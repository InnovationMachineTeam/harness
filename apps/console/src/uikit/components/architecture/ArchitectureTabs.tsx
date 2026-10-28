"use client";

import { useState } from "react";
import { Tabs } from "@/uikit";
import { ArchitectureMap } from "./ArchitectureMap";
import { SystemViews } from "./SystemViews";

const TABS = [
  { key: "map", label: "Карта" },
  { key: "system", label: "Система" },
  { key: "flows", label: "Потоки" },
  { key: "data", label: "Данные" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Вкладки раздела "Архитектура": карта слоёв, контуры системы, сквозные потоки и хранилища данных. */
export function ArchitectureTabs() {
  const [tab, setTab] = useState<TabKey>("map");
  return (
    <div className="flex flex-col gap-4">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "map" ? <ArchitectureMap /> : <SystemViews view={tab} />}
    </div>
  );
}
