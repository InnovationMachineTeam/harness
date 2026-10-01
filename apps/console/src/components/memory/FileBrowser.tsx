"use client";

import { cx, EmptyState } from "@/ui/UIKit";
import { FileViewer } from "./FileViewer";
import { MemoryNav, type NavGroup } from "./MemoryNav";

/**
 * Master-detail для файлов памяти: слева - MemoryNav (группы + дерево),
 * справа - просмотр выбранного файла.
 */
export function FileBrowser({
  groups,
  selected,
  onSelect,
}: {
  groups: NavGroup[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const nothingToShow = groups.every((g) => g.nodes.length === 0 && !g.note);
  return (
    <div className="grid gap-4 lg:h-[calc(100vh-15rem)] lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="max-h-[24rem] min-h-0 overflow-y-auto rounded-xl border border-line bg-surface/40 p-3 lg:max-h-none">
        {nothingToShow ? (
          <EmptyState size="sm">Пока нечего показывать.</EmptyState>
        ) : (
          <MemoryNav groups={groups} selected={selected} onSelect={onSelect} />
        )}
      </div>
      <div className="min-h-0 overflow-y-auto rounded-xl border border-line bg-surface/40 p-4">
        <FileViewer path={selected} />
      </div>
    </div>
  );
}
