"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Loading, Notice } from "@/ui/UIKit";
import { FileBrowser } from "./FileBrowser";
import { runtimeNavGroups, type RuntimeMemoryDTO } from "./groups";

/**
 * Вкладка Runtime страницы "Память": memory-файлы всех рантаймов, группы
 * по рантаймам (заголовок + линия), внутри - рабочие папки и "Глобальные".
 */
export function RuntimesTab() {
  const [runtimes, setRuntimes] = useState<RuntimeMemoryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/runtimes", { cache: "no-store" });
      const json = (await res.json()) as { runtimes: RuntimeMemoryDTO[] };
      setRuntimes(json.runtimes);
    } catch {
      setError("не удалось загрузить memory-файлы рантаймов");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!runtimes) return <Loading />;

  const totalFiles = runtimes.reduce(
    (sum, runtime) => sum + runtime.sources.reduce((s, source) => s + source.files.length, 0),
    0,
  );
  if (totalFiles === 0) {
    const withNotes = runtimes.filter((runtime) => runtime.note);
    return (
      <EmptyState>
        Ни у одного рантайма пока нет memory-файлов для рабочих папок - они появляются по мере
        работы рантаймов.
        {withNotes.length > 0 ? (
          <span className="mt-2 block text-xs">
            {withNotes.map((runtime) => `${runtime.displayName}: ${runtime.note}`).join(" · ")}
          </span>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <FileBrowser
      groups={runtimeNavGroups(runtimes)}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
