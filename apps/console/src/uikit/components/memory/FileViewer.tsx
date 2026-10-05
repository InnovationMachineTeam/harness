"use client";

import { useEffect, useState } from "react";
import { Chip, EmptyState, Loading, Notice } from "@/uikit";
import { MarkdownView } from "./MarkdownView";

interface FileData {
  name: string;
  isMarkdown: boolean;
  content: string;
  sizeBytes: number;
}

type ViewerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ok"; data: FileData; path: string };

/**
 * Просмотр файла памяти: markdown рендерится, остальное - как текст.
 * `onNavigate` открывает документ по ссылке изнутри markdown тем же просмотрщиком.
 */
export function FileViewer({
  path,
  onNavigate,
}: {
  path: string | null;
  onNavigate?: (path: string) => void;
}) {
  const [state, setState] = useState<ViewerState>({ status: "idle" });

  useEffect(() => {
    if (!path) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as FileData & { error?: string };
        if (!alive) return;
        if (!res.ok) setState({ status: "error", error: json.error ?? "ошибка чтения файла" });
        else setState({ status: "ok", data: json, path });
      })
      .catch(() => {
        if (alive) setState({ status: "error", error: "не удалось загрузить файл" });
      });
    return () => {
      alive = false;
    };
  }, [path]);

  if (state.status === "idle") {
    return <EmptyState>Выберите файл слева, чтобы прочитать его.</EmptyState>;
  }
  if (state.status === "loading") return <Loading>читаю файл…</Loading>;
  if (state.status === "error") return <Notice tone="error">{state.error}</Notice>;
  const { data } = state;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <h3 className="text-sm font-semibold text-fg">{data.name}</h3>
        <Chip tone={data.isMarkdown ? "sky" : "neutral"} mono>
          {data.isMarkdown ? "markdown" : "текст"}
        </Chip>
        <span className="shrink-0 font-mono text-[10px] text-fg-faint">
          {(data.sizeBytes / 1024).toFixed(1)} КБ
        </span>
        <span
          className="ml-auto max-w-full truncate font-mono text-[10px] text-fg-faint"
          title={state.path}
        >
          {state.path}
        </span>
      </div>
      {data.isMarkdown ? (
        <MarkdownView content={data.content} filePath={state.path} onNavigate={onNavigate} />
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-page p-3 font-mono text-xs text-fg-muted">
          {data.content}
        </pre>
      )}
    </div>
  );
}
