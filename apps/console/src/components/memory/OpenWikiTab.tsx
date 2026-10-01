"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { NavNode } from "@/core/memory";
import { Settings2 } from "lucide-react";
import { OPENWIKI_PRESETS, type LlmPreset } from "@/core/llmPresets";
import { LlmSettingsModal, type LlmSettingsValue } from "@/components/tools/LlmSettingsModal";
import { Button, Chip, EmptyState, IconButton, Loading, Notice, Panel } from "@/ui/UIKit";
import { FileBrowser } from "./FileBrowser";
import { findFileByName, findFirstFile, type NavGroup } from "./MemoryNav";

interface VisualizerStatus {
  exists: boolean;
  stale: boolean;
  generatedAt: string | null;
  slug: string;
}

interface WikiStatus {
  exists: boolean;
  tree: NavNode[];
  pageCount: number;
  lastUpdate: string | null;
  build: { running: boolean; mode: string | null; startedAt: string | null; logTail: string };
}

interface WikiFolder {
  dir: string;
  name: string;
  enabled: boolean;
  wiki: WikiStatus;
  visualizer: VisualizerStatus;
}

interface OpenWikiData {
  cli: { installed: boolean; version: string | null };
  folders: WikiFolder[];
  llm: { provider: string; apiKey: string; baseUrl: string; modelId: string };
}

/** Вкладка OpenWiki: вики включённых папок + запуск сборки через openwiki CLI. */
export function OpenWikiTab() {
  const [data, setData] = useState<OpenWikiData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [graphDir, setGraphDir] = useState<string | null>(null);
  const [vizBusy, setVizBusy] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/openwiki", { cache: "no-store" });
      const json = (await res.json()) as OpenWikiData;
      setData(json);
    } catch {
      setLoadError("не удалось загрузить статус OpenWiki");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // пока где-то идёт сборка - опрашиваем статус
  const anyRunning = data?.folders.some((folder) => folder.enabled && folder.wiki.build.running) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [anyRunning, load]);

  // авто-выбор index.md первой собранной вики
  useEffect(() => {
    if (!data || selected) return;
    for (const folder of data.folders) {
      if (!folder.enabled || !folder.wiki.exists) continue;
      const pick = findFileByName(folder.wiki.tree, "index.md") ?? findFirstFile(folder.wiki.tree);
      if (pick) {
        setSelected(pick);
        return;
      }
    }
  }, [data, selected]);

  const build = async (dir: string) => {
    setBusy(dir);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/openwiki/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить сборку");
      else setNotice(json.detail ?? "сборка запущена");
      await load();
    } catch {
      setActionError("не удалось запустить сборку");
    } finally {
      setBusy(null);
    }
  };

  /** Включить OpenWiki сразу для всех рабочих папок (из пустого состояния). */
  const enableAll = async () => {
    setBusy("enable-all");
    try {
      await fetch("/api/workspaces", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openwiki: (data?.folders ?? []).map((f) => f.dir) }),
      });
      await load();
    } catch {
      setActionError("не удалось включить папки");
    } finally {
      setBusy(null);
    }
  };

  const exportGraph = async (dir: string) => {
    setVizBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/openwiki/visualizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? json.detail ?? "не удалось построить граф");
      else {
        setNotice(json.detail ?? "визуализатор обновлён");
        setGraphDir(dir);
      }
      await load();
    } catch {
      setActionError("не удалось построить граф");
    } finally {
      setVizBusy(false);
    }
  };

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (!data) return <Loading />;

  const enabled = data.folders.filter((folder) => folder.enabled);
  if (enabled.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState>
          Ни одна рабочая папка не включена в OpenWiki. Включите тоггл OpenWiki в разделе{" "}
          <Link href="/workspaces" className="text-info underline underline-offset-2">
            Рабочие папки
          </Link>
          .
        </EmptyState>
        {data.folders.length > 0 ? (
          <div className="flex justify-center">
            <Button size="sm" variant="accent" disabled={busy !== null} onClick={() => void enableAll()}>
              Включить OpenWiki для всех рабочих папок
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const groups: NavGroup[] = enabled.map((folder) => {
    const { wiki } = folder;
    return {
      key: folder.dir,
      label: folder.name,
      hint: folder.dir,
      actions: (
        <>
          {wiki.build.running ? (
            <Chip tone="sky">сборка…</Chip>
          ) : wiki.exists ? (
            <Chip
              tone="emerald"
              title={wiki.lastUpdate ? `обновлена: ${wiki.lastUpdate}` : undefined}
            >
              {wiki.pageCount} стр.
            </Chip>
          ) : (
            <Chip tone="dashed">не собрана</Chip>
          )}
          <Button
            size="xs"
            variant={wiki.exists ? "neutral" : "accent"}
            disabled={!data.cli.installed || busy !== null}
            onClick={() => void build(folder.dir)}
          >
            {wiki.exists ? "Обновить" : "Собрать"}
          </Button>
          {wiki.exists ? (
            <Button
              size="xs"
              variant={graphDir === folder.dir ? "primary" : "neutral"}
              onClick={() => setGraphDir(graphDir === folder.dir ? null : folder.dir)}
            >
              {graphDir === folder.dir ? "Файлы" : "Граф"}
            </Button>
          ) : null}
        </>
      ),
      note: wiki.build.running ? (
        <pre className="max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border border-line bg-page p-2 font-mono text-[10px] leading-snug text-fg-faint">
          {wiki.build.logTail.trim() || "openwiki запускается…"}
        </pre>
      ) : !wiki.exists ? (
        <p className="text-xs text-fg-faint">
          Вики ещё не собрана - запуск <span className="font-mono">openwiki --init</span> создаст её в{" "}
          <span className="font-mono">openwiki/</span> внутри папки.
        </p>
      ) : undefined,
      nodes: wiki.tree,
    };
  });

  return (
    <div className="space-y-4">
      {!data.cli.installed ? (
        <Notice tone="error">
          openwiki CLI не установлен:{" "}
          <span className="font-mono">npm install -g openwiki</span> (Node ≥ 22; LLM-ключ
          настраивается при первом запуске CLI). Кнопки сборки отключены.
        </Notice>
      ) : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="flex justify-end">
        <IconButton
          icon={Settings2}
          label="Настроить LLM-провайдера"
          variant="ghostDim"
          onClick={() => setLlmOpen(true)}
        />
      </div>

      {graphDir ? (
        <GraphView
          folder={data.folders.find((folder) => folder.dir === graphDir) ?? null}
          onBack={() => setGraphDir(null)}
          onRebuild={(dir) => void exportGraph(dir)}
          busy={vizBusy}
        />
      ) : (
        <FileBrowser groups={groups} selected={selected} onSelect={setSelected} />
      )}

      <LlmSettingsModal
        open={llmOpen}
        onClose={() => setLlmOpen(false)}
        title="LLM-провайдер · OpenWiki"
        description="Провайдер передаётся openwiki CLI переменными окружения при сборке. Ключ хранится локально в state.json (вне git)."
        presets={OPENWIKI_PRESETS}
        initial={{ preset: "openai-compatible", apiKey: "ollama", baseUrl: "http://localhost:11434/v1", modelId: "" }}
        onSave={async (value) => {
          const body: Record<string, string> = {
            preset: value.preset,
            apiKey: value.apiKey,
            modelId: value.modelId,
          };
          if (value.baseUrl) body.baseUrl = value.baseUrl;
          try {
            const res = await fetch("/api/memory/openwiki/llm", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const json = (await res.json()) as { error?: string };
            return res.ok ? null : json.error ?? "не удалось сохранить";
          } catch {
            return "не удалось сохранить";
          }
        }}
      />
    </div>
  );
}

/** Встроенный статический визуализатор openwiki (граф вики). */
function GraphView({
  folder,
  onBack,
  onRebuild,
  busy,
}: {
  folder: WikiFolder | null;
  onBack: () => void;
  onRebuild: (dir: string) => void;
  busy: boolean;
}) {
  if (!folder) return null;
  const { visualizer } = folder;
  return (
    <Panel
      title={`Граф вики · ${folder.name}`}
      actions={
        <>
          {visualizer.exists && visualizer.stale ? <Chip tone="amber">устарел</Chip> : null}
          <Button
            size="xs"
            variant={visualizer.exists ? "neutral" : "accent"}
            disabled={busy || !folder.wiki.exists}
            onClick={() => onRebuild(folder.dir)}
          >
            {visualizer.exists ? "Обновить" : "Построить граф"}
          </Button>
          <Button size="xs" variant="ghost" onClick={onBack}>
            Файлы
          </Button>
        </>
      }
    >
      {visualizer.exists ? (
        <>
          <iframe
            key={visualizer.generatedAt ?? "empty"}
            src={`/visualizers/${visualizer.slug}/index.html`}
            title={`Граф вики ${folder.name}`}
            sandbox="allow-scripts allow-same-origin"
            className="h-[calc(100vh-20rem)] w-full rounded-lg border border-line"
          />
          <p className="mt-2 text-[11px] text-fg-faint">
            Библиотеки графа (force-graph, mermaid) загружаются с cdn.jsdelivr.net - для просмотра
            нужен интернет. Построение графа локальное и мгновенное, без LLM.
          </p>
        </>
      ) : (
        <EmptyState>
          Граф ещё не построен - "Построить граф" выполнит{" "}
          <span className="font-mono">openwiki visualize openwiki --export</span> (мгновенно, без
          LLM).
        </EmptyState>
      )}
    </Panel>
  );
}
