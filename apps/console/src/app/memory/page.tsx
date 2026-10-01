"use client";

import { useState } from "react";
import { DocsTab } from "@/components/memory/DocsTab";
import { GraphifyTab } from "@/components/memory/GraphifyTab";
import { OpenWikiTab } from "@/components/memory/OpenWikiTab";
import { RuntimesTab } from "@/components/memory/RuntimesTab";
import { Page, Tabs } from "@/ui/UIKit";

type Tab = "docs" | "openwiki" | "graphify" | "runtime";

const TABS: { key: Tab; label: string }[] = [
  { key: "docs", label: "Docs" },
  { key: "openwiki", label: "OpenWiki" },
  { key: "graphify", label: "Graphify" },
  { key: "runtime", label: "Runtime" },
];

/** Память: документы, вики OpenWiki, графы Graphify и memory-файлы рантаймов. */
export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>("docs");
  return (
    <Page
      title="Память"
      description="Документы рабочих папок, вики OpenWiki, графы знаний Graphify и memory-файлы рантаймов - всё читается с диска. Включение папок в OpenWiki/Graphify - тогглами в &quot;Рабочих папках&quot;."
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
      {tab === "runtime" ? <RuntimesTab /> : null}
    </Page>
  );
}
