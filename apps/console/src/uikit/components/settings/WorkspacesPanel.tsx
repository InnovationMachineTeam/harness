"use client";

import { useCallback, useEffect, useState } from "react";
import { InstallTerminal } from "@/uikit/components/skillsSh/InstallTerminal";
import { Button, Input, Loading, Modal, Notice, Panel, Toggle } from "@/uikit";

interface DirEntry {
  path: string;
  exists: boolean;
}

interface WorkspacesData {
  mandatory: DirEntry;
  additional: DirEntry[];
  openwiki: string[];
  graphify: string[];
  docs: string[];
}

interface CloneProject {
  name: string;
  path: string;
}

/** Вкладка "Рабочие папки" (Настройки): папки работы рантаймов и тогглы OpenWiki/Graphify/Docs. */
export function WorkspacesPanel() {
  const [data, setData] = useState<WorkspacesData | null>(null);
  const [newDir, setNewDir] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [projects, setProjects] = useState<CloneProject[]>([]);
  const [cloneJob, setCloneJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/workspaces", { cache: "no-store" });
    setData(await res.json());
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces/clone", { cache: "no-store" });
      const json = (await res.json()) as { projects?: CloneProject[] };
      setProjects(json.projects ?? []);
    } catch {
      /* список проектов не критичен */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadProjects();
  }, [load, loadProjects]);

  const save = async (body: {
    mandatory?: string;
    additional?: string[];
    openwiki?: string[];
    graphify?: string[];
    docs?: string[];
  }) => {
    setErrors([]);
    setNotice(null);
    const res = await fetch("/api/workspaces", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) {
      setErrors(result.errors ?? [result.error ?? "ошибка"]);
      return false;
    }
    setNotice("Сохранено");
    await load();
    return true;
  };

  const changeMandatory = async (path: string) => {
    await save({ mandatory: path });
  };

  const addDir = async () => {
    if (!newDir.trim() || !data) return;
    const ok = await save({ additional: [...data.additional.map((d) => d.path), newDir.trim()] });
    if (ok) setNewDir("");
  };

  const removeDir = async (path: string) => {
    if (!data) return;
    await save({ additional: data.additional.filter((d) => d.path !== path).map((d) => d.path) });
  };

  const toggleOpenWiki = async (path: string, enabled: boolean) => {
    if (!data) return;
    const next = enabled
      ? [...data.openwiki, path]
      : data.openwiki.filter((p) => p !== path);
    await save({ openwiki: next });
  };

  const toggleGraphify = async (path: string, enabled: boolean) => {
    if (!data) return;
    const next = enabled
      ? [...data.graphify, path]
      : data.graphify.filter((p) => p !== path);
    await save({ graphify: next });
  };

  const toggleDocs = async (path: string, enabled: boolean) => {
    if (!data) return;
    const next = enabled
      ? [...data.docs, path]
      : data.docs.filter((p) => p !== path);
    await save({ docs: next });
  };

  return (
    <>
      {errors.length > 0 ? (
        <Notice tone="error" className="mb-4">
          <ul className="space-y-1">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {notice ? <p className="mb-4 text-xs text-accent">{notice}</p> : null}

      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border border-accent/25 bg-accent/5 p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">
              Обязательная папка
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                size="form"
                defaultValue={data.mandatory.path}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value.trim() !== data.mandatory.path) {
                    void changeMandatory(e.target.value.trim());
                  }
                }}
                className="min-w-[24rem] flex-1 font-mono"
              />
              <span className={`text-[11px] ${data.mandatory.exists ? "text-accent" : "text-danger"}`}>
                {data.mandatory.exists ? "существует" : "не найдена!"}
              </span>
              <span className="ml-auto flex items-center gap-2 text-[11px] text-fg-faint">
                OpenWiki
                <Toggle
                  size="sm"
                  checked={data.openwiki.includes(data.mandatory.path)}
                  onChange={(v) => void toggleOpenWiki(data.mandatory.path, v)}
                  title="Собирать OpenWiki для этой папки"
                  ariaLabel="Собирать OpenWiki для обязательной папки"
                />
                Graphify
                <Toggle
                  size="sm"
                  checked={data.graphify.includes(data.mandatory.path)}
                  onChange={(v) => void toggleGraphify(data.mandatory.path, v)}
                  title="Собирать граф Graphify для этой папки"
                  ariaLabel="Собирать граф Graphify для обязательной папки"
                />
                Docs
                <Toggle
                  size="sm"
                  checked={data.docs.includes(data.mandatory.path)}
                  onChange={(v) => void toggleDocs(data.mandatory.path, v)}
                  title="Показывать документы папки во вкладке Docs"
                  ariaLabel="Показывать документы обязательной папки во вкладке Docs"
                />
              </span>
            </div>
            <p className="mt-2 text-[11px] text-fg-faint">
              Изменение применяется при потере фокуса поля. Должна существовать на диске.
            </p>
          </section>

          <Panel title={`Дополнительные папки (${data.additional.length})`} titleClassName="text-xs uppercase tracking-wide">
            {data.additional.length === 0 ? (
              <p className="mb-2 text-xs text-fg-faint">Не заданы.</p>
            ) : (
              <ul className="mb-3 divide-y divide-line/50">
                {data.additional.map((dir) => (
                  <li key={dir.path} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate font-mono text-xs text-fg-muted" title={dir.path}>
                      {dir.path}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`text-[11px] ${dir.exists ? "text-accent" : "text-danger"}`}>
                        {dir.exists ? "ок" : "не найдена"}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-fg-faint">
                        OpenWiki
                        <Toggle
                          size="sm"
                          checked={data.openwiki.includes(dir.path)}
                          onChange={(v) => void toggleOpenWiki(dir.path, v)}
                          title="Собирать OpenWiki для этой папки"
                          ariaLabel={`Собирать OpenWiki для ${dir.path}`}
                        />
                        Graphify
                        <Toggle
                          size="sm"
                          checked={data.graphify.includes(dir.path)}
                          onChange={(v) => void toggleGraphify(dir.path, v)}
                          title="Собирать граф Graphify для этой папки"
                          ariaLabel={`Собирать граф Graphify для ${dir.path}`}
                        />
                        Docs
                        <Toggle
                          size="sm"
                          checked={data.docs.includes(dir.path)}
                          onChange={(v) => void toggleDocs(dir.path, v)}
                          title="Показывать документы папки во вкладке Docs"
                          ariaLabel={`Показывать документы ${dir.path} во вкладке Docs`}
                        />
                      </span>
                      <Button variant="danger" size="xs" onClick={() => void removeDir(dir.path)}>
                        убрать
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                size="form"
                value={newDir}
                onChange={(e) => setNewDir(e.target.value)}
                placeholder="/absolute/path/to/project"
                className="flex-1 font-mono"
              />
              <Button variant="neutral" size="md" onClick={() => void addDir()}>
                Добавить
              </Button>
            </div>
          </Panel>

          <Panel
            title="Локальные проекты (sources/)"
            titleClassName="text-xs uppercase tracking-wide"
            actions={
              <Button size="xs" variant="accent" onClick={() => setCloneOpen(true)}>
                Клонировать репозиторий
              </Button>
            }
          >
            <p className="text-[11px] leading-relaxed text-fg-faint">
              Папка <span className="font-mono">sources/</span> - для локальной работы с кодом репозиториев, над
              которыми ведётся работа (в git не попадает). Склонированные проекты видны агентам как часть рабочей
              папки sources.
            </p>
            {projects.length === 0 ? (
              <p className="mt-2 text-xs text-fg-faint">
                Пока пусто. Если папки sources нет или она пуста - "Клонировать репозиторий" создаст её и склонирует
                проект по https-ссылке.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {projects.map((project) => (
                  <li key={project.path} className="truncate font-mono text-xs text-fg-muted" title={project.path}>
                    {project.name}/
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {cloneOpen ? (
        <CloneModal
          onClose={() => setCloneOpen(false)}
          onStarted={(jobId) => setCloneJob(jobId)}
          onDone={async () => {
            await loadProjects();
          }}
        />
      ) : null}
      {cloneJob ? (
        <Modal open onClose={() => setCloneJob(null)} title="git clone" width="max-w-2xl">
          <InstallTerminal
            jobId={cloneJob}
            streamUrl={`/api/tools/job?jobId=${encodeURIComponent(cloneJob)}`}
            inputUrl="/api/tools/job/input"
            onDone={() => void loadProjects()}
          />
        </Modal>
      ) : null}
    </>
  );
}

/** Модалка клонирования: https-ссылка на репозиторий → job git clone в sources/. */
function CloneModal({
  onClose,
  onStarted,
  onDone,
}: {
  onClose: () => void;
  onStarted: (jobId: string) => void;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clone = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !json.jobId) setError(json.error ?? "не удалось запустить клонирование");
      else {
        onStarted(json.jobId);
        onDone();
        onClose();
      }
    } catch {
      setError("не удалось запустить клонирование");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Клонировать репозиторий"
      description="https-ссылка на git-репозиторий; проект появится в sources/ и будет виден агентам в рабочей папке sources."
      width="max-w-xl"
    >
      <div className="space-y-3">
        <Input
          size="form"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
          className="w-full font-mono"
          aria-label="ссылка на репозиторий"
        />
        <Input
          size="form"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="имя каталога (необязательно - из ссылки)"
          className="w-full font-mono"
          aria-label="имя каталога"
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="accent" disabled={busy || !url.trim()} onClick={() => void clone()}>
            {busy ? "Запуск…" : "Клонировать"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
