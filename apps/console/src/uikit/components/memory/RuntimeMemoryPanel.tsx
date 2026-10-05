"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Loading, Notice } from "@/uikit";
import { FileBrowser } from "./FileBrowser";
import { runtimeNavGroups, type RuntimeMemoryDTO } from "./groups";

/**
 * Вкладка "Память" на странице рантайма: memory-файлы этого рантайма
 * по рабочим папкам (+ "Глобальные").
 */
export function RuntimeMemoryPanel({ runtime }: { runtime: string }) {
  const [data, setData] = useState<RuntimeMemoryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/memory/runtimes?runtime=${encodeURIComponent(runtime)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { runtimes: RuntimeMemoryDTO[] };
      setData(json.runtimes[0] ?? null);
    } catch {
      setError("не удалось загрузить memory-файлы");
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  if (!data.supported) {
    return (
      <EmptyState>
        {data.note ?? "у этого рантайма нет файловой памяти, которую консоль может показать."}
      </EmptyState>
    );
  }
  const totalFiles = data.sources.reduce((sum, source) => sum + source.files.length, 0);
  if (totalFiles === 0) {
    return (
      <EmptyState>
        memory-файлы для рабочих папок пока не созданы - они появляются по мере работы рантайма.
        {data.note ? <span className="mt-2 block text-xs">{data.note}</span> : null}
      </EmptyState>
    );
  }

  return (
    <FileBrowser
      groups={runtimeNavGroups([data])}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
