"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { NavNode } from "@/core/memory";
import { Button, Chip, EmptyState, Input, Loading, Notice, Panel, Select } from "@/uikit";
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
  /** Обязательная рабочая папка (write mode) - единственная цель сборки. */
  mandatoryWorkspace?: string;
}

/** Вкладка OpenWiki: вики включённых папок, сборка через openwiki CLI или headless-агента, вики-воркспейсы. */
export function OpenWikiTab() {
  const [data, setData] = useState<OpenWikiData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [graphDir, setGraphDir] = useState<string | null>(null);
  const [vizBusy, setVizBusy] = useState(false);

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

  /**
   * Агентская сборка: headless-сессия рантайма по умолчанию (★) с
   * интеграцией openwiki пишет страницы своей моделью; задача видна в
   * Мониторинге со ссылкой на сессию.
   */
  const buildViaAgent = async (dir: string) => {
    setBusy(`${dir}:agent`);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/openwiki/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, via: "agent" }),
      });
      const json = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) setActionError(json.error ?? "не удалось запустить агентскую сборку");
      else setNotice(`${json.detail ?? "агентская сборка запущена"} - задача в "Мониторинг → Задачи"`);
      await load();
    } catch {
      setActionError("не удалось запустить агентскую сборку");
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
          <Link href="/settings?tab=workspaces" className="text-info underline underline-offset-2">
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
        ) : null}      </div>
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
          {folder.dir === data.mandatoryWorkspace ? (
            <>
              <Button
                size="xs"
                variant={wiki.exists ? "neutral" : "accent"}
                disabled={!data.cli.installed || busy === folder.dir}
                onClick={() => void build(folder.dir)}
              >
                {wiki.exists ? "Обновить" : "Собрать"}
              </Button>
              <Button
                size="xs"
                variant="ghostDim"
                disabled={busy === `${folder.dir}:agent`}
                title={'Сборка через headless-агента с интеграцией openwiki (рантайм ★ из настроек "Исполнение команд") - его модель пишет страницы, без LLM-провайдера openwiki'}
                onClick={() => void buildViaAgent(folder.dir)}
              >
                через агент ★
              </Button>
            </>
          ) : (
            <Chip tone="dim" title="Дополнительная папка - read mode: сборка выполняется только в обязательной рабочей папке">
              только чтение
            </Chip>
          )}
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

      {graphDir ? (
        <GraphView
          folder={data.folders.find((folder) => folder.dir === graphDir) ?? null}
          onBack={() => setGraphDir(null)}
          onRebuild={(dir) => void exportGraph(dir)}
          busy={vizBusy}
        />
      ) : (
        <>
          <WorkspacesPanel />
          <FileBrowser groups={groups} selected={selected} onSelect={setSelected} />
        </>
      )}
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

/* --------------------------------- воркспейсы -------------------------------- */

interface WorkspaceInfo {
  id: string;
  name: string;
  wikis: string[];
}

interface FolderWorkspaceStatus {
  dir: string;
  name: string;
  wikiId: string | null;
  linkable: boolean;
  active: string | null;
  containing: { id: string; name: string }[];
}

interface WorkspacesData {
  workspaces: WorkspaceInfo[];
  folders: FolderWorkspaceStatus[];
}

/**
 * Мультирепозиторные вики-воркспейсы (openwiki link/workspace): объединяют
 * собранные вики рабочих папок для агентского поиска (MCP openwiki_search
 * ищет по всем участникам). Реестр - ~/.openwiki/wiki-workspaces.json; CLI
 * `openwiki link` - интерактивный TUI, поэтому состав правит консоль.
 */
function WorkspacesPanel() {
  const [data, setData] = useState<WorkspacesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/openwiki/workspaces", { cache: "no-store" });
      const json = (await res.json()) as WorkspacesData;
      setData(json);
    } catch {
      setError("не удалось загрузить воркспейсы");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, okMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memory/openwiki/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) setError(json.error ?? "действие не выполнено");
      else {
        setNotice(okMessage);
        setName("");
        setPicked([]);
      }
      await load();
    } catch {
      setError("действие не выполнено");
    } finally {
      setBusy(false);
    }
  };

  if (data === null) {
    return error ? <Notice tone="error">{error}</Notice> : null;
  }

  const workspaceName = (id: string | null): string =>
    data.workspaces.find((ws) => ws.id === id)?.name ?? id ?? "";
  const linkable = data.folders.filter((f) => f.linkable);

  return (
    <Panel
      title="Воркспейсы"
      actions={
        <span className="text-[11px] text-fg-faint">
          поиск агента (openwiki_search) идёт по всем вики воркспейса
        </span>
      }
    >
      <div className="space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}

        {data.workspaces.length > 0 ? (
          <div className="space-y-1">
            {data.workspaces.map((ws) => (
              <div key={ws.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Chip tone="sky">{ws.name}</Chip>
                <span className="text-fg-muted">{ws.wikis.join(" · ")}</span>
                <Button
                  size="xs"
                  variant="ghostDim"
                  disabled={busy}
                  title="Удалить воркспейс (вики участников остаются)"
                  onClick={() => void act({ action: "delete", workspaceId: ws.id }, `воркспейс "${ws.name}" удалён`)}
                >
                  удалить
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-faint">
            Воркспейсов нет - каждая вики ищет сама себя. Объедините минимум две собранные вики.
          </p>
        )}

        <div className="space-y-1 border-t border-line/60 pt-2">
          {data.folders.map((folder) => {
            const label = folder.active
              ? `активный: ${workspaceName(folder.active)}`
              : folder.containing.length === 1
                ? `${folder.containing[0].name} (автоматически)`
                : folder.containing.length > 1
                  ? "несколько воркспейсов - активный не выбран"
                  : folder.wikiId
                    ? "своя вики"
                    : "не зарегистрирована";
            return (
              <div key={folder.dir} className="flex flex-wrap items-center gap-2 text-xs" title={folder.dir}>
                <span className="min-w-24 font-medium text-fg-muted">{folder.name}</span>
                <Chip tone={folder.active ? "emerald" : "dim"}>{label}</Chip>
                {folder.containing.length > 0 ? (
                  <Select
                    value={folder.active ?? ""}
                    onChange={(id) =>
                      void act(
                        id ? { action: "use", dir: folder.dir, workspaceId: id } : { action: "clear", dir: folder.dir },
                        id ? `активный воркспейс "${workspaceName(id)}" для ${folder.name}` : `активный воркспейс ${folder.name} сброшен`,
                      )
                    }
                    options={[
                      { value: "", label: folder.active ? "сбросить" : "по умолчанию" },
                      ...folder.containing.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    ariaLabel={`активный воркспейс ${folder.name}`}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {linkable.length >= 2 ? (
          <div className="space-y-2 border-t border-line/60 pt-2">
            <p className="text-xs text-fg-muted">Создать воркспейс (минимум две собранные вики):</p>
            <Input
              size="form"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="имя, например Платформа"
              aria-label="имя воркспейса"
              className="max-w-xs"
            />
            <div className="flex flex-wrap gap-3">
              {linkable.map((folder) => (
                <label key={folder.dir} className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={picked.includes(folder.dir)}
                    onChange={(e) =>
                      setPicked((prev) =>
                        e.target.checked ? [...prev, folder.dir] : prev.filter((d) => d !== folder.dir),
                      )
                    }
                  />
                  {folder.name}
                </label>
              ))}
            </div>
            <Button
              size="xs"
              variant="accent"
              disabled={busy || picked.length < 2 || name.trim().length === 0}
              onClick={() => void act({ action: "link", name, dirs: picked }, `воркспейс "${name.trim()}" создан`)}
            >
              Создать
            </Button>
          </div>
        ) : (
          <p className="text-xs text-fg-faint border-t border-line/60 pt-2">
            Для воркспейса нужны минимум две папки с собранной вики - сейчас собрано: {linkable.length}.
          </p>
        )}
      </div>
    </Panel>
  );
}
