"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { NavNode } from "@/core/memory";
import { Button, Chip, EmptyState, Loading, Notice, Panel } from "@/uikit";
import { FileBrowser } from "./FileBrowser";
import { findFileByName, findFirstFile } from "./MemoryNav";

interface GraphifyFolderStatus {
  exists: boolean;
  nodes: number | null;
  edges: number | null;
  lastBuild: string | null;
  build: { running: boolean; mode: string | null; startedAt: string | null; logTail: string };
}

interface GraphifyWikiStatus {
  exists: boolean;
  articles: number | null;
  lastBuild: string | null;
  build: { running: boolean; startedAt: string | null; logTail: string };
  /** Дерево статей для просмотра (пустой - wiki не собрана). */
  tree: NavNode[];
}

interface GraphifyFolder {
  dir: string;
  name: string;
  /** Путь воркспейса в хранилище относительно корня репозитория (graphify/<имя>). */
  workspace: string;
  enabled: boolean;
  graph: GraphifyFolderStatus;
  wiki: GraphifyWikiStatus;
  published: { exists: boolean; generatedAt: string | null; slug: string };
}

interface GraphifyData {
  cli: { installed: boolean };
  /** Хранилище воркспейсов относительно корня репозитория (graphify). */
  store: string;
  folders: GraphifyFolder[];
  /** Обязательная рабочая папка (write mode) - единственная цель сборки. */
  mandatoryWorkspace?: string;
  /** Объединённый граф собранных папок (виртуальный воркспейс graphify-out/all-in-one). */
  allInOne?: GraphifyAllInOne;
}

interface GraphifyAllInOne {
  /** Воркспейс All-in-One относительно корня репозитория. */
  dir: string;
  /** Каталог артефактов относительно корня репозитория (<dir>/graphify-out). */
  out: string;
  graph: GraphifyFolderStatus;
  wiki: GraphifyWikiStatus;
  published: { exists: boolean; generatedAt: string | null; slug: string };
}

/** Открытый просмотр: граф или статьи wiki папки, либо All-in-One. */
type TabView = { mode: "graph" | "wiki"; dir: string } | { mode: "merge-graph" | "merge-wiki" } | null;

/**
 * Вкладка Graphify: графы знаний рабочих папок в хранилище
 * ./graphify/<имя>/graphify-out (graphify extract + cluster-only - отвязанная
 * сборка с graph.html), wiki из графа (graphify export wiki) с просмотром
 * статей, встроенный graph.html (публикация в public/graphify, iframe с того
 * же origin; vis-network грузится с CDN unpkg). Блок All-in-One вверху
 * объединяет собранные графы папок (graphify merge-graphs + cluster-only) в
 * graphify-out/all-in-one и собирает из него единую wiki.
 */
export function GraphifyTab() {
  const [data, setData] = useState<GraphifyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<TabView>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/graphify", { cache: "no-store" });
      const json = (await res.json()) as GraphifyData;
      setData(json);
    } catch {
      setLoadError("не удалось загрузить статус Graphify");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyRunning =
    data?.folders.some((folder) => folder.enabled && (folder.graph.build.running || folder.wiki.build.running)) ??
    false;
  const mergeRunning = data?.allInOne ? data.allInOne.graph.build.running || data.allInOne.wiki.build.running : false;
  useEffect(() => {
    if (!anyRunning && !mergeRunning) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [anyRunning, mergeRunning, load]);

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
   * Полная сборка (код + доки, имена сообществ) через headless-рантайм по
   * умолчанию: doc-файлы требуют семантической экстракции с LLM-ключом - его
   * окружение может содержать ключ; агенту доступен установленный навык graphify.
   */
  const buildViaRuntime = async (dir: string, workspace: string) => {
    setBusy(`${dir}:rt`);
    setActionError(null);
    setNotice(null);
    const prompt = [
      `Собери полный граф знаний Graphify для папки "${dir}" (код + документы).`,
      "",
      "Команды (выполни литерально, cwd - корень репозитория):",
      `graphify extract "${dir}" --out "${workspace}"`,
      `graphify cluster-only "${workspace}"`,
      "- extract собирает граф; cluster-only достраивает graph.html и",
      "  GRAPH_REPORT.md и называет сообщества через LLM;",
      "- doc/paper/image файлы требуют семантической экстракции - используй",
      "  LLM-ключ из своего окружения (GEMINI_API_KEY/ANTHROPIC_API_KEY/…)",
      "  или навык graphify (/graphify), если он доступен;",
      "- если ключей нет - остановись и сообщи пользователю, какой ключ добавить",
      `  (или предложи то же с --code-only - локальный AST без ключа);`,
      "- статус консоль увидит в логе, путь вернёт консоль.",
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

  /** Wiki из графа: graphify export wiki (статьи - в graphify-out/wiki/). */
  const buildWiki = async (dir: string) => {
    setBusy(`${dir}:wiki`);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/graphify/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить сборку wiki");
      else setNotice(json.detail ?? "сборка wiki запущена");
      await load();
    } catch {
      setActionError("не удалось запустить сборку wiki");
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
        setView({ mode: "graph", dir });
      }
      await load();
    } catch {
      setActionError("не удалось опубликовать граф");
    } finally {
      setBusy(null);
    }
  };

  const openView = (next: TabView) => {
    setView(next);
    setSelected(null);
  };

  /** Объединить собранные графы папок в All-in-One (merge-graphs + cluster-only). */
  const merge = async () => {
    setBusy("all-in-one");
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/graphify/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить сборку All-in-One");
      else setNotice(json.detail ?? "сборка All-in-One запущена");
      await load();
    } catch {
      setActionError("не удалось запустить сборку All-in-One");
    } finally {
      setBusy(null);
    }
  };

  /** Единая wiki из объединённого графа (graphify export wiki). */
  const mergeWiki = async () => {
    setBusy("all-in-one:wiki");
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/graphify/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wiki: true }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить сборку wiki All-in-One");
      else setNotice(json.detail ?? "сборка wiki All-in-One запущена");
      await load();
    } catch {
      setActionError("не удалось запустить сборку wiki All-in-One");
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
          <Link href="/settings?tab=workspaces" className="text-info underline underline-offset-2">
            Workspaces
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

  const aio = data.allInOne;
  const mergeSources = enabled.filter((folder) => folder.graph.exists);
  const openFolder = view && "dir" in view ? enabled.find((f) => f.dir === view.dir) ?? null : null;

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

      {openFolder && view?.mode === "wiki" ? (
        <WikiView
          folder={openFolder}
          busy={busy}
          cliInstalled={data.cli.installed}
          selected={selected}
          onSelect={setSelected}
          onRebuild={(dir) => void buildWiki(dir)}
          onBack={() => openView(null)}
        />
      ) : openFolder && view?.mode === "graph" ? (
        <Panel
          title={`Граф знаний · ${openFolder.name}`}
          actions={
            <>
              {openFolder.graph.nodes !== null ? (
                <Chip tone="sky">
                  {openFolder.graph.nodes} узл. · {openFolder.graph.edges ?? "?"} рёб.
                </Chip>
              ) : null}
              <Button size="xs" variant="neutral" disabled={busy === openFolder.dir} onClick={() => void publish(openFolder.dir)}>
                Обновить
              </Button>
              <Button size="xs" variant="ghost" onClick={() => openView(null)}>
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
      ) : view?.mode === "merge-graph" && aio ? (
        <Panel
          title="Граф знаний · All-in-One"
          actions={
            <>
              {aio.graph.nodes !== null ? (
                <Chip tone="sky">
                  {aio.graph.nodes} узл. · {aio.graph.edges ?? "?"} рёб.
                </Chip>
              ) : null}
              <Button size="xs" variant="neutral" onClick={() => void load()} title="Переопубликовать graph.html и перезагрузить">
                Обновить
              </Button>
              <Button size="xs" variant="ghost" onClick={() => openView(null)}>
                К папкам
              </Button>
            </>
          }
        >
          {aio.published.exists ? (
            <>
              <iframe
                key={aio.published.generatedAt ?? "empty"}
                src={`/graphify/${aio.published.slug}/index.html`}
                title="Граф знаний All-in-One"
                sandbox="allow-scripts allow-same-origin"
                className="h-[calc(100vh-20rem)] w-full rounded-lg border border-line"
              />
              <p className="mt-2 text-[11px] text-fg-faint">
                Объединение собранных графов папок - узлы несут атрибут источника (repo). Библиотека графа (vis-network)
                загружается с unpkg - для просмотра нужен интернет.
              </p>
            </>
          ) : (
            <EmptyState>Граф All-in-One не опубликован - кнопка "Собрать" в списке папок соберёт и опубликует его.</EmptyState>
          )}
        </Panel>
      ) : view?.mode === "merge-wiki" && aio ? (
        <MergeWikiView
          wiki={aio.wiki}
          out={aio.out}
          busy={busy}
          cliInstalled={data.cli.installed}
          selected={selected}
          onSelect={setSelected}
          onRebuild={() => void mergeWiki()}
          onBack={() => openView(null)}
        />
      ) : (
        <div className="space-y-3">
          {aio ? (
            <Panel
              as="article"
              title="All-in-One"
              actions={
                <>
                  <Chip tone="muted" title="собранные графы папок - источники объединения">
                    {mergeSources.length} ист.
                  </Chip>
                  {aio.graph.build.running ? (
                    <Chip tone="sky">сборка…</Chip>
                  ) : aio.graph.exists ? (
                    <Chip tone="emerald" title={aio.graph.lastBuild ? `собран: ${aio.graph.lastBuild}` : undefined}>
                      {aio.graph.nodes !== null ? `${aio.graph.nodes} узл. · ${aio.graph.edges ?? "?"} рёб.` : "готов"}
                    </Chip>
                  ) : (
                    <Chip tone="dashed">не собран</Chip>
                  )}
                  {aio.wiki.build.running ? (
                    <Chip tone="sky">wiki…</Chip>
                  ) : aio.wiki.exists ? (
                    <Chip tone="emerald" title={aio.wiki.lastBuild ? `wiki собрана: ${aio.wiki.lastBuild}` : undefined}>
                      wiki: {aio.wiki.articles ?? "?"} ст.
                    </Chip>
                  ) : null}
                  {aio.graph.exists && aio.published.exists ? <Chip tone="muted">граф опубликован</Chip> : null}
                  {aio.published.exists ? (
                    <Button
                      size="xs"
                      variant="ghostDim"
                      onClick={() => openView({ mode: "merge-graph" })}
                      title="Открыть объединённый граф (iframe, та же публикация)"
                    >
                      Граф знаний
                    </Button>
                  ) : null}
                  {aio.wiki.exists ? (
                    <Button
                      size="xs"
                      variant="ghostDim"
                      onClick={() => openView({ mode: "merge-wiki" })}
                      title="Читать единую wiki по всем папкам"
                    >
                      Статьи wiki
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant={aio.graph.exists ? "neutral" : "accent"}
                    disabled={!data.cli.installed || mergeSources.length === 0 || aio.graph.build.running || aio.wiki.build.running}
                    title="Объединение собранных графов папок: graphify merge-graphs … + cluster-only (локально, без LLM); корневой граф репозитория не затрагивается"
                    onClick={() => void merge()}
                  >
                    {aio.graph.exists ? "Обновить" : "Собрать"}
                  </Button>
                  {aio.graph.exists ? (
                    <Button
                      size="xs"
                      variant={aio.wiki.exists ? "neutral" : "accent"}
                      disabled={!data.cli.installed || aio.graph.build.running || aio.wiki.build.running}
                      title="Единая wiki из объединённого графа: graphify export wiki - статьи markdown в graphify-out/all-in-one/graphify-out/wiki/"
                      onClick={() => void mergeWiki()}
                    >
                      {aio.wiki.exists ? "Wiki заново" : "Wiki"}
                    </Button>
                  ) : null}
                </>
              }
            >
              <p className="font-mono text-[11px] text-fg-faint" title="объединение графов папок в один граф">
                graphify merge-graphs … --out {aio.out}/graph.json
              </p>
              {mergeSources.length > 0 ? (
                <p className="mt-0.5 text-[11px] text-fg-faint">
                  Источники: {mergeSources.map((f) => `${f.name} (${f.graph.nodes ?? "?"} узл.)`).join(", ")}
                  {enabled.length > mergeSources.length
                    ? `; нет графа: ${enabled.filter((f) => !f.graph.exists).map((f) => f.name).join(", ")} - пропущены`
                    : ""}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-fg-faint">
                  Нет собранных графов папок - соберите граф хотя бы одной папки кнопкой "Собрать".
                </p>
              )}
              {aio.graph.build.running || aio.wiki.build.running ? (
                <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border border-line bg-page p-2 font-mono text-[10px] leading-snug text-fg-faint">
                  {(aio.graph.build.running ? aio.graph.build.logTail : aio.wiki.build.logTail).trim() ||
                    "graphify запускается…"}
                </pre>
              ) : null}
            </Panel>
          ) : null}
          {enabled.map((folder) => {
            const { graph, wiki, published } = folder;
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
                    {wiki.build.running ? (
                      <Chip tone="sky">wiki…</Chip>
                    ) : wiki.exists ? (
                      <Chip tone="emerald" title={wiki.lastBuild ? `wiki собрана: ${wiki.lastBuild}` : undefined}>
                        wiki: {wiki.articles ?? "?"} ст.
                      </Chip>
                    ) : null}
                    {graph.exists && published.exists ? <Chip tone="muted">граф опубликован</Chip> : null}
                    {published.exists ? (
                      <Button
                        size="xs"
                        variant="ghostDim"
                        onClick={() => openView({ mode: "graph", dir: folder.dir })}
                        title="Открыть граф знаний этой папки (iframe, та же публикация)"
                      >
                        Граф знаний
                      </Button>
                    ) : null}
                    {wiki.exists ? (
                      <Button
                        size="xs"
                        variant="ghostDim"
                        onClick={() => openView({ mode: "wiki", dir: folder.dir })}
                        title="Читать статьи wiki этой папки"
                      >
                        Статьи wiki
                      </Button>
                    ) : null}
                    {folder.dir === data.mandatoryWorkspace ? (
                      <>
                        <Button
                          size="xs"
                          variant={graph.exists ? "neutral" : "accent"}
                          disabled={!data.cli.installed || busy === folder.dir || graph.build.running}
                          onClick={() => void build(folder.dir)}
                          title="Локальная сборка в хранилище: code-only (AST, без LLM-ключа) + cluster-only (graph.html); повторная - инкрементальная"
                        >
                          {graph.exists ? "Обновить" : "Собрать"}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghostDim"
                          disabled={busy === `${folder.dir}:rt`}
                          title="Полная сборка (код + доки, имена сообществ) через headless-рантайм по умолчанию - его окружение может содержать LLM-ключ"
                          onClick={() => void buildViaRuntime(folder.dir, folder.workspace)}
                        >
                          через runtime ★
                        </Button>
                      </>
                    ) : (
                      <Chip tone="dim" title="Дополнительная папка - read mode: сборка выполняется только в обязательной рабочей папке">
                        только чтение
                      </Chip>
                    )}
                    {graph.exists ? (
                      <Button
                        size="xs"
                        variant={wiki.exists ? "neutral" : "accent"}
                        disabled={!data.cli.installed || busy === `${folder.dir}:wiki` || wiki.build.running || graph.build.running}
                        title="Wiki из графа: graphify export wiki - статьи markdown в graphify-out/wiki/ (index.md - точка входа)"
                        onClick={() => void buildWiki(folder.dir)}
                      >
                        {wiki.exists ? "Wiki заново" : "Wiki"}
                      </Button>
                    ) : null}
                    {graph.exists ? (
                      <Button
                        size="xs"
                        variant={published.exists ? "neutral" : "accent"}
                        disabled={busy === folder.dir}
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
                <p className="mt-0.5 font-mono text-[11px] text-fg-faint" title="воркспейс в хранилище графов">
                  {folder.workspace}/graphify-out
                </p>
                {graph.build.running ? (
                  <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border border-line bg-page p-2 font-mono text-[10px] leading-snug text-fg-faint">
                    {graph.build.logTail.trim() || "graphify запускается…"}
                  </pre>
                ) : wiki.build.running ? (
                  <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border border-line bg-page p-2 font-mono text-[10px] leading-snug text-fg-faint">
                    {wiki.build.logTail.trim() || "graphify export wiki запускается…"}
                  </pre>
                ) : !graph.exists ? (
                  <p className="mt-2 text-xs text-fg-faint">
                    Сборка выполнит <span className="font-mono">graphify extract &lt;папка&gt; --out {folder.workspace}</span>{" "}
                    и <span className="font-mono">graphify cluster-only {folder.workspace}</span> - граф (graph.json +
                    graph.html) появится в <span className="font-mono">{folder.workspace}/graphify-out</span>. Запросы к
                    графу -{" "}
                    <span className="font-mono">graphify query "…" --graph {folder.workspace}/graphify-out/graph.json</span>.
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

/** Просмотр статей wiki Graphify: дерево слева, markdown справа. */
function WikiView({
  folder,
  busy,
  cliInstalled,
  selected,
  onSelect,
  onRebuild,
  onBack,
}: {
  folder: GraphifyFolder;
  busy: string | null;
  cliInstalled: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
  onRebuild: (dir: string) => void;
  onBack: () => void;
}) {
  // авто-выбор index.md - точки входа wiki
  useEffect(() => {
    if (selected) return;
    const pick = findFileByName(folder.wiki.tree, "index.md") ?? findFirstFile(folder.wiki.tree);
    if (pick) onSelect(pick);
  }, [selected, folder.wiki.tree, onSelect]);

  return (
    <Panel
      title={`Wiki Graphify · ${folder.name}`}
      actions={
        <>
          {folder.wiki.build.running ? (
            <Chip tone="sky">сборка…</Chip>
          ) : (
            <Chip tone="emerald">{folder.wiki.articles ?? "?"} ст.</Chip>
          )}
          <Button
            size="xs"
            variant="neutral"
            disabled={!cliInstalled || busy === `${folder.dir}:wiki` || folder.wiki.build.running || folder.graph.build.running}
            onClick={() => onRebuild(folder.dir)}
          >
            Пересобрать
          </Button>
          <Button size="xs" variant="ghost" onClick={onBack}>
            К папкам
          </Button>
        </>
      }
    >
      <FileBrowser
        groups={[
          {
            key: folder.dir,
            label: folder.name,
            hint: `${folder.workspace}/graphify-out/wiki`,
            nodes: folder.wiki.tree,
          },
        ]}
        selected={selected}
        onSelect={onSelect}
      />
    </Panel>
  );
}

/** Просмотр единой wiki All-in-One: дерево слева, markdown справа. */
function MergeWikiView({
  wiki,
  out,
  busy,
  cliInstalled,
  selected,
  onSelect,
  onRebuild,
  onBack,
}: {
  wiki: GraphifyWikiStatus;
  out: string;
  busy: string | null;
  cliInstalled: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
  onRebuild: () => void;
  onBack: () => void;
}) {
  // авто-выбор index.md - точки входа wiki
  useEffect(() => {
    if (selected) return;
    const pick = findFileByName(wiki.tree, "index.md") ?? findFirstFile(wiki.tree);
    if (pick) onSelect(pick);
  }, [selected, wiki.tree, onSelect]);

  return (
    <Panel
      title="Wiki Graphify · All-in-One"
      actions={
        <>
          {wiki.build.running ? (
            <Chip tone="sky">сборка…</Chip>
          ) : (
            <Chip tone="emerald">{wiki.articles ?? "?"} ст.</Chip>
          )}
          <Button
            size="xs"
            variant="neutral"
            disabled={!cliInstalled || busy === "all-in-one:wiki" || wiki.build.running}
            onClick={onRebuild}
          >
            Пересобрать
          </Button>
          <Button size="xs" variant="ghost" onClick={onBack}>
            К папкам
          </Button>
        </>
      }
    >
      <FileBrowser
        groups={[{ key: "all-in-one", label: "All-in-One", hint: `${out}/wiki`, nodes: wiki.tree }]}
        selected={selected}
        onSelect={onSelect}
      />
    </Panel>
  );
}
