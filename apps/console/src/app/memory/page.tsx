"use client";

import { useState } from "react";
import { CombosTab } from "@/uikit/components/memory/CombosTab";
import { DocsTab } from "@/uikit/components/memory/DocsTab";
import { GraphifyTab } from "@/uikit/components/memory/GraphifyTab";
import { OpenWikiTab } from "@/uikit/components/memory/OpenWikiTab";
import { RuntimesTab } from "@/uikit/components/memory/RuntimesTab";
import { Page, Tabs } from "@/uikit";

type Tab = "docs" | "openwiki" | "graphify" | "combos" | "runtime";

const TABS: { key: Tab; label: string }[] = [
  { key: "docs", label: "Docs" },
  { key: "openwiki", label: "OpenWiki" },
  { key: "graphify", label: "Graphify" },
  { key: "combos", label: "Связки" },
  { key: "runtime", label: "Память" },
];

/** Знание: документы, вики OpenWiki, графы Graphify, связки памяти и вкладка Память (memory-файлы рантаймов). */
export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>("docs");
  return (
    <Page
      title="Знание"
      description="Документы рабочих папок, вики OpenWiki, графы знаний Graphify, связки памяти (neo4j + LightRAG, neo4j + Qdrant) и вкладка Память - memory-файлы рантаймов. Включение папок в OpenWiki/Graphify/Docs - тогглами в &quot;Настройках → Workspaces&quot;."
    >
      <Tabs
        tabs={TABS}
        active={tab}
        onChange={setTab}
        className="mb-6 border-b border-line/60 pb-2"
      />
      {tab === "docs" ? <DocsTab /> : null}
      {tab === "openwiki" ? <OpenWikiTab /> : null}
      {tab === "graphify" ? <GraphifyTab /> : null}
      {tab === "combos" ? <CombosTab /> : null}
      {tab === "runtime" ? <RuntimesTab /> : null}
    </Page>
  );
}
