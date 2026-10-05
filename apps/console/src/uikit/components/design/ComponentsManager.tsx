"use client";

import { useEffect, useRef, useState } from "react";
import { ListTree, PackagePlus, Plus, X } from "lucide-react";
import { postJson } from "@/uikit/components/design/design-api";
import { Button, Chip, EmptyState, FieldLabel, Footnote, Input, Notice, Panel } from "@/uikit";

/**
 * Менеджер design/components.json: реестр компонентов web и mobile рабочей
 * папки. Записи добавляются и удаляются вручную (каждая мутация сохраняется
 * через POST {action:"save-components"}), "Пересканировать" заполняет манифест
 * из типовых каталогов проекта (action scan-components; компонент - файл
 * PascalCase или папка с index.tsx), "Зарегистрировать кит" добавляет
 * компоненты кита (action register-kit - папки <kit>/components/<Name>).
 * Дальше манифест ведут рантаймы - задачи дизайн-раннера.
 */

interface ComponentsEntry {
  name: string;
  path: string;
}

interface Manifest {
  web: ComponentsEntry[];
  mobile: ComponentsEntry[];
}

export function ComponentsManager(props: {
  dir: string;
  components: { exists: boolean };
  manifest: Manifest | null;
  /** Рост значения перезагружает локальный черновик из props. */
  revision: number;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Manifest>(props.manifest ?? { web: [], mobile: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ web: ComponentsEntry; mobile: ComponentsEntry }>({
    web: { name: "", path: "" },
    mobile: { name: "", path: "" },
  });
  const revisionRef = useRef(props.revision);
  const dirtyRef = useRef(false);

  const serialized = (value: Manifest) => JSON.stringify({ web: value.web, mobile: value.mobile });
  dirtyRef.current = serialized(draft) !== serialized(props.manifest ?? { web: [], mobile: [] });

  useEffect(() => {
    if (revisionRef.current === props.revision || dirtyRef.current) return;
    revisionRef.current = props.revision;
    setDraft(props.manifest ?? { web: [], mobile: [] });
  }, [props.revision, props.manifest]);

  const persist = async (next: Manifest) => {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/design/workspace", { action: "save-components", dir: props.dir, manifest: next });
      setDraft(next);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ manifest: Manifest }>("/api/design/workspace", { action: "scan-components", dir: props.dir });
      setDraft(data.manifest);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const registerKit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ manifest: Manifest }>("/api/design/workspace", { action: "register-kit", dir: props.dir });
      setDraft(data.manifest);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const add = (platform: "web" | "mobile") => {
    const entry = adding[platform];
    const name = entry.name.trim();
    const componentPath = entry.path.trim();
    if (!name || !componentPath) return;
    if (draft[platform].some((item) => item.path === componentPath)) return;
    void persist({ ...draft, [platform]: [...draft[platform], { name, path: componentPath }] });
    setAdding((current) => ({ ...current, [platform]: { name: "", path: "" } }));
  };

  const remove = (platform: "web" | "mobile", componentPath: string) => {
    void persist({ ...draft, [platform]: draft[platform].filter((item) => item.path !== componentPath) });
  };

  if (!props.components.exists) {
    return (
      <Panel title="Компоненты проекта">
        <EmptyState size="sm">design/components.json не создан - создайте пакет ("Создать из пресета" во вкладке Обзор).</EmptyState>
      </Panel>
    );
  }

  const section = (platform: "web" | "mobile", title: string) => (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center gap-2">
        <FieldLabel>{title}</FieldLabel>
        <Chip tone="neutral">{draft[platform].length}</Chip>
      </div>
      {draft[platform].length === 0 ? (
        <EmptyState size="sm">Записей нет - пересканируйте или добавьте вручную.</EmptyState>
      ) : (
        <div className="space-y-1">
          {draft[platform].map((item) => (
            <div key={item.path} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
              <span className="text-[11px] font-medium text-fg">{item.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-faint" title={item.path}>{item.path}</span>
              <Button variant="ghostDim" size="xs" disabled={busy} onClick={() => remove(platform, item.path)} aria-label={`удалить ${item.name}`}>
                <X size={10} aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-end gap-2">
        <div className="w-36">
          <Input
            value={adding[platform].name}
            onChange={(event) => setAdding((current) => ({ ...current, [platform]: { ...current[platform], name: event.target.value } }))}
            placeholder="Имя"
            aria-label={`имя компонента ${platform}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Input
            value={adding[platform].path}
            onChange={(event) => setAdding((current) => ({ ...current, [platform]: { ...current[platform], path: event.target.value } }))}
            placeholder="путь/от/корня.tsx"
            aria-label={`путь компонента ${platform}`}
          />
        </div>
        <Button variant="ghostDim" disabled={busy || !adding[platform].name.trim() || !adding[platform].path.trim()} onClick={() => add(platform)}>
          <Plus size={12} aria-hidden /> Добавить
        </Button>
      </div>
    </div>
  );

  return (
    <Panel
      title="Компоненты проекта (design/components.json)"
      actions={
        <>
          <Button variant="ghostDim" disabled={busy} onClick={() => void registerKit()}>
            <PackagePlus size={12} aria-hidden /> Зарегистрировать кит
          </Button>
          <Button variant="ghostDim" disabled={busy} onClick={() => void scan()}>
            <ListTree size={12} aria-hidden /> Пересканировать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 xl:flex-row">
        {section("web", "Web")}
        {section("mobile", "Mobile")}
      </div>
      <Footnote className="mt-3">
        Компонент - PascalCase-файл или папка с index.tsx в типовых каталогах; компоненты кита вне каталогов добавляются кнопкой "Зарегистрировать кит".
      </Footnote>
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </Panel>
  );
}
