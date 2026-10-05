"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Footnote, Modal, Notice, Segmented, Textarea } from "@/uikit";
import { EFFORT_LEVELS, MODEL_TIERS } from "@/core/workflows/schema";
import {
  ArtifactChipsField,
  asRecord,
  asStringList,
  ChipsField,
  FormSection,
  LinesField,
  NumberField,
  parseYamlSafe,
  removeInputChip,
  removeOutputChip,
  renameStepInYaml,
  RUNTIME_OPTIONS,
  SelectField,
  spliceEntity,
  TextField,
  TextareaField,
  ToggleField,
  yamlOf,
} from "./editor-shared";

export type RoleOption = { value: string; label: string };

type Segment = "input" | "execution" | "output" | "common";

/**
 * Провайдеры AI SDK как кандидаты runtime ("provider:<id>"): в списке - только
 * активные (status "active" из GET /api/providers); при сбое загрузки - весь каталог.
 */
export function useProviderRuntimeOptions(): Array<{ value: string; label: string }> {
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    fetch("/api/providers", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const providers = (j.providers ?? []) as Array<{ id: string; label: string; status?: string }>;
      const active = providers.filter((p) => p.status === "active");
      const list = (active.length ? active : providers).map((p) => ({ value: "provider:" + p.id, label: "provider:" + p.id + " · " + p.label + (active.length ? "" : " (не активен)") }));
      setOptions(list);
    }).catch(() => undefined);
  }, []);
  return options;
}

/** Варианты кандидатов runtime шага: установленные CLI-рантаймы и активные провайдеры AI SDK. */
export function useRuntimeCandidateOptions(): Array<{ value: string; label: string }> {
  const providerOptions = useProviderRuntimeOptions();
  const [runtimeOptions, setRuntimeOptions] = useState<Array<{ value: string; label: string }>>(RUNTIME_OPTIONS);
  useEffect(() => {
    // Установленные рантаймы: из GET /api/runtimes исключаются disabled (не установлены).
    fetch("/api/runtimes", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const runtimes = (j.runtimes ?? []) as Array<{ id: string; displayName?: string; status?: string }>;
      const usable = runtimes.filter((r) => r.status !== "disabled");
      if (usable.length) setRuntimeOptions(usable.map((r) => ({ value: r.id, label: r.id + (r.displayName ? " · " + r.displayName : "") })));
    }).catch(() => undefined);
  }, []);
  return useMemo(() => [...runtimeOptions, ...providerOptions], [runtimeOptions, providerOptions]);
}

export function NodeEditorModal({
  nodeId,
  workflow,
  yaml,
  roleOptions,
  onYamlChange,
  onRename,
  onDelete,
  onClose,
  onSave,
}: {
  nodeId: string;
  workflow: { id: string; title: string; fileName: string };
  yaml: string;
  roleOptions: RoleOption[];
  onYamlChange: (next: string) => void;
  /** Смена id шага: студия переключает открытый редактор на новый id. */
  onRename?: (newId: string) => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
  onSave: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [segment, setSegment] = useState<Segment>("execution");
  const [nodeDraft, setNodeDraft] = useState<string | null>(null);
  const [idDraft, setIdDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const runtimeCandidateOptions = useRuntimeCandidateOptions();

  const parsed = useMemo(() => parseYamlSafe(yaml), [yaml]);
  const doc = parsed.ok ? asRecord(parsed.value) : {};
  const nodes = Array.isArray(doc.nodes) ? doc.nodes.map(asRecord) : [];
  const raw = nodes.find((item) => item.id === nodeId);
  const rawInput = asRecord(raw?.inputControl);
  const rawExecution = asRecord(raw?.execution);
  const rawOutput = asRecord(raw?.outputControl);
  const rawRuntime = asRecord(raw?.runtime);
  const rawRetry = asRecord(raw?.retry);
  const rawResources = asRecord(raw?.resources);
  // Runtime по умолчанию workflow: шаг с пустым списком кандидатов наследует его.
  const workflowCandidates = asStringList(asRecord(asRecord(doc.defaults).runtime).candidates);
  const stepCandidates = asStringList(rawRuntime.candidates);

  const updateNode = (updates: Record<string, unknown>) => {
    if (!raw) return;
    const nested = ["inputControl", "execution", "outputControl", "runtime", "retry", "resources"];
    const next: Record<string, unknown> = { ...raw };
    for (const key of nested) {
      if (key in updates) {
        const value = updates[key];
        if (value === null) {
          delete next[key];
          continue;
        }
        const merged: Record<string, unknown> = { ...asRecord(next[key]), ...(value as Record<string, unknown>) };
        for (const [field, fieldValue] of Object.entries(merged)) {
          if (fieldValue === undefined) delete merged[field];
        }
        next[key] = merged;
      }
    }
    for (const [key, value] of Object.entries(updates)) {
      if (!nested.includes(key)) next[key] = value;
    }
    const spliced = spliceEntity(yaml, "nodes", next);
    if (spliced !== null) {
      onYamlChange(spliced);
      setNodeDraft(null);
    }
  };

  const nodeText = nodeDraft ?? (raw ? yamlOf(raw) : "");
  const nodeParsed = parseYamlSafe(nodeText);
  const changeNodeText = (text: string) => {
    setNodeDraft(text);
    const candidate = parseYamlSafe(text);
    if (!candidate.ok || !candidate.value || typeof candidate.value !== "object" || Array.isArray(candidate.value)) return;
    const spliced = spliceEntity(yaml, "nodes", candidate.value as Record<string, unknown>);
    if (spliced !== null) onYamlChange(spliced);
  };

  const save = async () => setSaveState(await onSave());
  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  const stepInputs = asStringList(raw?.inputs);
  const stepOutputs = asStringList(raw?.outputs);
  const inputOptions = nodes
    .filter((item) => String(item.id) !== nodeId)
    .flatMap((item) => asStringList(item.outputs).map((output) => ({ value: output, label: `${output} · ${String(item.id)}` })))
    .filter((option) => !stepInputs.includes(option.value));
  const currentId = String(raw?.id ?? nodeId);
  const changeId = (value: string) => {
    setIdDraft(value);
    const candidate = value.trim();
    if (candidate === currentId || !/^[a-z0-9][a-z0-9._-]*$/.test(candidate)) return;
    if (nodes.some((item) => String(item.id) === candidate)) return;
    const next = renameStepInYaml(yaml, nodeId, candidate);
    if (next !== null) {
      onYamlChange(next);
      setIdDraft(null);
      onRename?.(candidate);
    }
  };

  const sectionBody = !raw ? null : segment === "input" ? (
    <>
      <ToggleField label="Секция включена" value={Boolean(raw?.inputControl)} onChange={(on) => updateNode({ inputControl: on ? { roles: [], prompt: "", dor: [], maxAttempts: 10 } : null })} title="Проверка входа по DoR до взятия в работу" />
      {raw?.inputControl ? <>
        <ChipsField label="Роли входного контроля" value={asStringList(rawInput.roles)} options={roleOptions} onChange={(roles) => updateNode({ inputControl: { roles } })} />
        <TextareaField label="Задача входного контроля (промпт)" value={String(rawInput.prompt ?? "")} onChange={(prompt) => updateNode({ inputControl: { prompt } })} rows={3} />
        <LinesField label="DoR (критерии готовности входа)" value={asStringList(rawInput.dor)} onChange={(dor) => updateNode({ inputControl: { dor } })} />
        <NumberField label="Количество попыток" min={1} max={50} value={Number(rawInput.maxAttempts ?? 10)} onChange={(maxAttempts) => updateNode({ inputControl: { maxAttempts } })} />
      </> : <Notice>Секция выключена: вход шага не проверяется.</Notice>}
    </>
  ) : segment === "execution" ? (
    <>
      <ChipsField label="Роли исполнители" value={asStringList(raw?.roles)} options={roleOptions} onChange={(roles) => updateNode({ roles })} />
      <TextareaField label="Задача исполнения (промпт)" value={String(rawExecution.prompt ?? "")} onChange={(prompt) => updateNode({ execution: { prompt } })} rows={4} />
      <ToggleField label="Ручное подтверждение плана" value={Boolean(rawExecution.confirmPlan)} onChange={(confirmPlan) => updateNode({ execution: { confirmPlan } })} title="План по DoD/AC показывается оператору; без подтверждения прогон стоит на паузе" />
    </>
  ) : segment === "output" ? (
    <>
      <ToggleField label="Секция включена" value={Boolean(raw?.outputControl)} onChange={(on) => updateNode({ outputControl: on ? { roles: [], tests: [], dod: [], ac: [], manualReview: false, maxAttempts: 10 } : null })} title="Ревью результата, чек-лист тестов, ручная приёмка" />
      {raw?.outputControl ? <>
        <ChipsField label="Роли ревью (несколько)" value={asStringList(rawOutput.roles)} options={roleOptions} onChange={(roles) => updateNode({ outputControl: { roles } })} />
        <LinesField label="Чек-лист типов тестов" value={asStringList(rawOutput.tests)} onChange={(tests) => updateNode({ outputControl: { tests } })} />
        <LinesField label="DoD (готовность результата)" value={asStringList(rawOutput.dod)} onChange={(dod) => updateNode({ outputControl: { dod } })} />
        <LinesField label="AC (критерии приёмки)" value={asStringList(rawOutput.ac)} onChange={(ac) => updateNode({ outputControl: { ac } })} />
        <ToggleField label="Ручной выходной контроль" value={Boolean(rawOutput.manualReview)} onChange={(manualReview) => updateNode({ outputControl: { manualReview } })} title="После успешных авто-проверок - окно приёмки: принять, отклонить с комментарием, отложить" />
        <NumberField label="Количество попыток приёмки" min={1} max={50} value={Number(rawOutput.maxAttempts ?? 10)} onChange={(maxAttempts) => updateNode({ outputControl: { maxAttempts } })} />
      </> : <Notice>Секция выключена: результат шага не проходит ревью.</Notice>}
    </>
  ) : (
    <>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="ID" value={idDraft ?? currentId} onChange={changeId} mono />
        <TextField label="Название" value={String(raw.title ?? "")} onChange={(title) => updateNode({ title })} />
        <TextField label="Фаза" value={String(raw.phase ?? "")} onChange={(phase) => updateNode({ phase })} />
        <NumberField label="timeoutMs" min={1000} max={86_400_000} value={Number(raw?.timeoutMs ?? 900_000)} onChange={(timeoutMs) => updateNode({ timeoutMs })} />
      </div>
      <Footnote>ID уникален в workflow; переименование обновляет связи - dependsOn, входы и артефакты по всему файлу.</Footnote>
      <TextareaField label="Описание шага" value={String(raw.description ?? "")} onChange={(description) => updateNode({ description })} rows={2} />
      <FormSection title="Рантайм">
        <ChipsField
          label="Runtime candidates (порядок = порядок failover; перетаскивайте чипы)"
          value={stepCandidates}
          options={runtimeCandidateOptions}
          onChange={(candidates) => updateNode({ runtime: { candidates } })}
          addLabel="Добавить runtime или provider:<id>"
          sortable
          emptyHint={workflowCandidates.length ? "Список пуст - шаг наследует runtime workflow: " + workflowCandidates.join(" → ") : "Список пуст и workflow не задаёт runtime - исполнители не назначены"}
        />
        {stepCandidates.length && workflowCandidates.length ? <Button onClick={() => updateNode({ runtime: { candidates: [] } })}>Сбросить к наследованию workflow ({workflowCandidates.join(" → ")})</Button> : null}
        <Footnote>Кандидаты - CLI-рантаймы и провайдеры AI SDK (значение "provider:идентификатор", исполнение в процессе консоли через LangChain). Пустой список наследует defaults.runtime workflow.</Footnote>
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Tier (пусто - наследуется ролью)" allowEmpty value={String(rawRuntime.tier ?? "")} options={MODEL_TIERS.map((value) => ({ value, label: value }))} onChange={(tier) => updateNode({ runtime: { tier: tier || undefined } })} />
          <SelectField label="Effort (пусто - наследуется ролью)" allowEmpty value={String(rawRuntime.effort ?? "")} options={EFFORT_LEVELS.map((value) => ({ value, label: value }))} onChange={(effort) => updateNode({ runtime: { effort: effort || undefined } })} />
          <NumberField label="Попытки failover" min={1} max={10} value={Number(rawRetry.maxAttempts ?? 3)} onChange={(maxAttempts) => updateNode({ retry: { maxAttempts } })} />
          <SelectField label="Режим workspace" value={String(rawResources.workspace ?? "read")} options={["read", "write", "worktree"].map((value) => ({ value, label: value }))} onChange={(workspace) => updateNode({ resources: { workspace } })} />
        </div>
      </FormSection>
      <Notice>Зависимости заполняются связями на канве; удаление чипа входа разрывает связь.</Notice>
      <ArtifactChipsField
        label="inputs (артефакты от связанных шагов)"
        value={stepInputs}
        options={inputOptions}
        onChange={(next) => updateNode({ inputs: next })}
        onRemove={(name) => {
          const next = removeInputChip(yaml, nodeId, name);
          if (next !== null) onYamlChange(next);
        }}
        addLabel="Добавить вход"
      />
      <ArtifactChipsField
        label="outputs (артефакты шага)"
        value={stepOutputs}
        options={[]}
        onChange={(next) => updateNode({ outputs: next })}
        onRemove={(name) => {
          const next = removeOutputChip(yaml, nodeId, name);
          if (next !== null) onYamlChange(next);
        }}
        allowCustom
        addLabel="Добавить выход"
      />
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-5xl"
      title={`Шаг: ${String(raw?.title ?? nodeId)}`}
      description={`Workflow ${workflow.title} (${workflow.fileName}). Секции шага: входной контроль, исполнение, выходной контроль.`}
      footer={
        <>
          <Button variant="danger" disabled={deleting} onClick={remove} className="mr-auto">Удалить шаг</Button>
          {saveState ? (
            <span className={`mr-2 text-xs ${saveState.ok ? "text-accent" : "text-danger"}`}>
              {saveState.ok ? "Сохранено" : saveState.error ?? "Ошибка сохранения"}
            </span>
          ) : null}
          <Button variant="primary" onClick={save}>Validate &amp; save</Button>
          <Button onClick={onClose}>Закрыть</Button>
        </>
      }
    >
      <Segmented
        className="mb-3 w-fit max-w-full"
        ariaLabel="Секции шага"
        value={segment}
        onChange={setSegment}
        options={[
          { key: "execution", label: "Исполнение" },
          { key: "input", label: "Входной контроль" },
          { key: "output", label: "Выходной контроль" },
          { key: "common", label: "Общее" },
        ]}
      />
      {!parsed.ok ? <Notice tone="error" className="mb-3">YAML файла не парсится: {parsed.error}</Notice> : null}
      {!raw ? (
        <EmptyState>Шаг {nodeId} отсутствует в YAML. Восстановите его во вкладке YAML файла или закройте редактор.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-[56vh] space-y-3 overflow-y-auto pr-1">{sectionBody}</div>
          <div className="h-[56vh] overflow-y-auto">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">YAML шага</p>
            <Textarea value={nodeText} onChange={(e) => changeNodeText(e.target.value)} rows={22} className="h-[50vh] w-full resize-none font-mono text-[11px]" spellCheck={false} />
            <div className="mt-1">
              {!nodeParsed.ok ? <span className="text-[10px] text-danger">Ошибка YAML: {nodeParsed.error}</span> : <span className="text-[10px] text-fg-faint">Синхронизировано с формой и целым файлом</span>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
