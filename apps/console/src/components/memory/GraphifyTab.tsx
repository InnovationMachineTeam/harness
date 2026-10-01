"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, EmptyState, Loading, Notice, Panel } from "@/ui/UIKit";

interface GraphifyFolderStatus {
  exists: boolean;
  nodes: number | null;
  edges: number | null;
  lastBuild: string | null;
  build: { running: boolean; mode: string | null; startedAt: string | null; logTail: string };
}

interface GraphifyFolder {
  dir: string;
  name: string;
  enabled: boolean;
  graph: GraphifyFolderStatus;
  published: { exists: boolean; generatedAt: string | null; slug: string };
}

interface GraphifyData {
  cli: { installed: boolean };
  folders: GraphifyFolder[];
}

/**
 * Вкладка Graphify: граф знаний включённых папок (graphify extract/update -
 * отвязанная сборка) и встроенный graph.html (публикация в public/graphify,
 * iframe с того же origin; vis-network грузится с CDN unpkg).
 */
export function GraphifyTab() {
  const [data, setData] = useState<GraphifyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [graphDir, setGraphDir] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/graphify", { cache: "no-store" });
      const json = (await res.json()) as GraphifyData;
      setData((prev) => ({ ...json, folders: json.folders }));
    } catch {
      setLoadError("не удалось загрузить статус Graphify");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyRunning = data?.folders.some((folder) => folder.enabled && folder.graph.build.running) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [anyRunning, load]);

  const build = async (dir: string) => {
    setBusy(dir);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/graphify/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить сборку графа");
      else setNotice(json.detail ?? "сборка графа запущена");
      await load();
    } catch {
      setActionError("не удалось запустить сборку графа");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Полная сборка (код + доки) через headless-рантайм по умолчанию:
   * doc-файлы требуют семантической экстракции с LLM-ключом - его окружение
   * может содержать ключ; агенту доступен установленный навык graphify.
   */
  const buildViaRuntime = async (dir: string) => {
    setBusy(`${dir}:rt`);
    setActionError(null);
    setNotice(null);
    const prompt = [
      `Собери полный граф знаний Graphify для папки "${dir}" (код + документы).`,
      "",
      `Команда (выполни с cwd = "${dir}", литерально): graphify extract .`,
      "- doc/paper/image файлы требуют семантической экстракции - используй",
      "  LLM-ключ из своего окружения (GEMINI_API_KEY/ANTHROPIC_API_KEY/…)",
      "  или навык graphify (/graphify .), если он доступен;",
      "- если ключей нет - остановись и сообщи пользователю, какой ключ добавить",
      "  (или предложи graphify extract . --code-only - локальный AST без ключа);",
      "- статус консоль увидит в graphify-out/.console-build.log.",
      "",
      "Соблюдай AGENTS.md и guard.",
    ].join("\n");
    try {
      const res = await fetch("/api/prompts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = (await res.json()) as { runtime?: string; warning?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить сборку через рантайм");
      else if (json.warning) setActionError(json.warning);
      else
        setNotice(
          `полная сборка через рантайм запущена (${json.runtime ?? "★ по умолчанию"}); сессия появится на странице рантайма`,
        );
    } catch {
      setActionError("не удалось запустить сборку через рантайм");
    } finally {
      setBusy(null);
    }
  };

  /** Включить Graphify сразу для всех рабочих папок (из пустого состояния). */
  const enableAll = async () => {
    setBusy("enable-all");
    try {
      await fetch("/api/workspaces", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphify: (data?.folders ?? []).map((f) => f.dir) }),
      });
      await load();
    } catch {
      setActionError("не удалось включить папки");
    } finally {
      setBusy(null);
    }
  };

  const publish = async (dir: string) => {
    setBusy(dir);
    setActionError(null);
    try {
      const res = await fetch("/api/memory/graphify/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? json.detail ?? "не удалось опубликовать граф");
      else {
        setNotice(json.detail ?? "граф опубликован");
        setGraphDir(dir);
      }
      await load();
    } catch {
      setActionError("не удалось опубликовать граф");
    } finally {
      setBusy(null);
    }
  };

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (!data) return <Loading />;

  const enabled = data.folders.filter((folder) => folder.enabled);
  if (enabled.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState>
          Ни одна рабочая папка не включена в Graphify. Включите тоггл Graphify в разделе{" "}
          <Link href="/workspaces" className="text-info underline underline-offset-2">
            Рабочие папки
          </Link>
          .
        </EmptyState>
        {data.folders.length > 0 ? (
          <div className="flex justify-center">
            <Button size="sm" variant="accent" disabled={busy !== null} onClick={() => void enableAll()}>
              Включить Graphify для всех рабочих папок
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const openFolder = graphDir ? enabled.find((f) => f.dir === graphDir) ?? null : null;

  return (
    <div className="space-y-4">
      {!data.cli.installed ? (
        <Notice tone="error">
          graphify CLI не установлен: <span className="font-mono">uv tool install graphifyy</span> (Python 3.12+) - или
          через "Настройки → Инструменты". Кнопки сборки отключены.
        </Notice>
      ) : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {openFolder ? (
        <Panel
          title={`Граф знаний · ${openFolder.name}`}
          actions={
            <>
              {openFolder.graph.nodes !== null ? (
                <Chip tone="sky">
                  {openFolder.graph.nodes} узл. · {openFolder.graph.edges ?? "?"} рёб.
                </Chip>
              ) : null}
              <Button size="xs" variant="neutral" disabled={busy !== null} onClick={() => void publish(openFolder.dir)}>
                Обновить
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setGraphDir(null)}>
                К папкам
              </Button>
            </>
          }
        >
          {openFolder.published.exists ? (
            <>
              <iframe
                key={openFolder.published.generatedAt ?? "empty"}
                src={`/graphify/${openFolder.published.slug}/index.html`}
                title={`Граф знаний ${openFolder.name}`}
                sandbox="allow-scripts allow-same-origin"
                className="h-[calc(100vh-20rem)] w-full rounded-lg border border-line"
              />
              <p className="mt-2 text-[11px] text-fg-faint">
                Библиотека графа (vis-network) загружается с unpkg - для просмотра нужен интернет. Сборка графа
                локальная (tree-sitter, без LLM).
              </p>
            </>
          ) : (
            <EmptyState>
              Граф не опубликован - "Обновить" скопирует <span className="font-mono">graphify-out/graph.html</span> в
              статику консоли.
            </EmptyState>
          )}
        </Panel>
      ) : (
        <div className="space-y-3">
          {enabled.map((folder) => {
            const { graph, published } = folder;
            return (
              <Panel
                as="article"
                key={folder.dir}
                title={folder.name}
                actions={
                  <>
                    {graph.build.running ? (
                      <Chip tone="sky">сборка…</Chip>
                    ) : graph.exists ? (
                      <Chip tone="emerald" title={graph.lastBuild ? `собран: ${graph.lastBuild}` : undefined}>
                        {graph.nodes !== null ? `${graph.nodes} узл.` : "готов"}
                      </Chip>
                    ) : (
                      <Chip tone="dashed">не собран</Chip>
                    )}
                    {graph.exists && published.exists ? <Chip tone="muted">граф опубликован</Chip> : null}
                    <Button
                      size="xs"
                      variant={graph.exists ? "neutral" : "accent"}
                      disabled={!data.cli.installed || busy !== null}
                      onClick={() => void build(folder.dir)}
                      title="Локальная сборка: code-only (AST, без LLM-ключа)"
                    >
                      {graph.exists ? "Обновить" : "Собрать"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghostDim"
                      disabled={busy !== null}
                      title="Полная сборка (код + доки) через headless-рантайм по умолчанию - его окружение может содержать LLM-ключ"
                      onClick={() => void buildViaRuntime(folder.dir)}
                    >
                      через runtime ★
                    </Button>
                    {graph.exists ? (
                      <Button
                        size="xs"
                        variant={published.exists ? "neutral" : "accent"}
                        disabled={busy !== null}
                        onClick={() => void publish(folder.dir)}
                      >
                        {published.exists ? "Переопубликовать" : "Опубликовать"}
                      </Button>
                    ) : null}
                  </>
                }
              >
                <p className="text-xs text-fg-faint" title={folder.dir}>
                  {folder.dir}
                </p>
                {graph.build.running ? (
                  <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border border-line bg-page p-2 font-mono text-[10px] leading-snug text-fg-faint">
                    {graph.build.logTail.trim() || "graphify запускается…"}
                  </pre>
                ) : !graph.exists ? (
                  <p className="mt-2 text-xs text-fg-faint">
                    Сборка выполнит <span className="font-mono">graphify extract .</span> - граф появится в{" "}
                    <span className="font-mono">graphify-out/</span> (graph.json + graph.html).
                  </p>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
