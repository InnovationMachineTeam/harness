"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { NavNode } from "@/core/memory";
import { EmptyState, Loading, Notice } from "@/uikit";
import { FileBrowser } from "./FileBrowser";
import { findFileByName, findFirstFile, type NavGroup } from "./MemoryNav";

interface DocsFolder {
  dir: string;
  name: string;
  enabled: boolean;
  count: number;
  tree: NavNode[];
}

/** Вкладка Docs: markdown-документы папок, включённых тогглом Docs (дерево + рендер). */
export function DocsTab() {
  const [folders, setFolders] = useState<DocsFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/docs", { cache: "no-store" });
      const json = (await res.json()) as { folders: DocsFolder[] };
      setFolders(json.folders);
    } catch {
      setError("не удалось загрузить список документов");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // авто-выбор первого осмысленного документа: README → AGENTS → первый файл
  useEffect(() => {
    if (!folders || selected) return;
    for (const folder of folders.filter((f) => f.enabled)) {
      const pick =
        findFileByName(folder.tree, "README.md") ??
        findFileByName(folder.tree, "AGENTS.md") ??
        findFirstFile(folder.tree);
      if (pick) {
        setSelected(pick);
        return;
      }
    }
  }, [folders, selected]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!folders) return <Loading />;
  const enabled = folders.filter((folder) => folder.enabled);
  if (enabled.length === 0) {
    return (
      <EmptyState>
        Ни одна рабочая папка не включена в Docs. Включите тоггл Docs в разделе{" "}
        <Link href="/settings?tab=workspaces" className="text-info underline underline-offset-2">
          Рабочие папки
        </Link>
        .
      </EmptyState>
    );
  }

  const groups: NavGroup[] = enabled.map((folder) => ({
    key: folder.dir,
    label: folder.name,
    hint: folder.dir,
    note:
      folder.count === 0 ? (
        <p className="text-xs text-fg-faint">markdown-документов в этой папке нет</p>
      ) : undefined,
    nodes: folder.tree,
  }));
  return <FileBrowser groups={groups} selected={selected} onSelect={setSelected} />;
}
