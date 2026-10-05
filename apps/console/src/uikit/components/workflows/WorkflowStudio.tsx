"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import YAML from "yaml";
import { Button, Chip, confirmDialog, Input, Modal, Select, Textarea } from "@/uikit";
import { NodeEditorModal, useRuntimeCandidateOptions, type RoleOption } from "./NodeEditorModal";
import { asRecord, asStringList, ChipsField, parseYamlSafe, removeNodeFromYaml, spliceEntity } from "./editor-shared";

type StepNode = { id: string; title: string; phase: string; roles: string[]; dependsOn: string[]; ui?: { x: number; y: number } };
type Workflow = { id: string; title: string; description: string; nodes: StepNode[]; yaml: string; etag: string; fileName: string; scope: string };
type Run = { id: string; title: string; workflowId: string; status: string };
type RoleEntry = { id: string; title: string; folder: string };

function WorkflowCard({ data }: NodeProps) {
  const item = data.item as StepNode;
  return <div title="Открыть редактор шага" className="w-52 cursor-pointer rounded-lg border border-line-strong bg-surface p-2 shadow transition-colors hover:border-info">
    <Handle type="target" position={Position.Left} />
    <div className="text-[10px] uppercase text-info">{item.phase}</div>
    <div className="text-xs font-semibold">{item.title}</div>
    <div className="mt-1 flex flex-wrap gap-1">{item.roles.slice(0, 3).map((role) => <Chip key={role} tone="sky" mono>{role}</Chip>)}{item.roles.length > 3 ? <Chip tone="muted">+{item.roles.length - 3}</Chip> : null}</div>
    <Handle type="source" position={Position.Right} />
  </div>;
}

export function WorkflowStudio() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState("");
  const [yaml, setYaml] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState("");
  const [roleEntries, setRoleEntries] = useState<RoleEntry[]>([]);
  const [editorNodeId, setEditorNodeId] = useState("");
  const [conflict, setConflict] = useState<{ base: string; current: string; draft: string } | null>(null);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [newWfOpen, setNewWfOpen] = useState(false);
  const [newWfId, setNewWfId] = useState("");
  const [newWfTitle, setNewWfTitle] = useState("");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneNewId, setCloneNewId] = useState("");
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const runtimeCandidateOptions = useRuntimeCandidateOptions();
  const lastLoadedId = useRef("");
  const load = useCallback(async () => {
    const [w, r, roles] = await Promise.all([
      fetch("/api/workflows", { cache: "no-store" }).then((x) => x.json()).catch(() => ({})),
      fetch("/api/workflow-runs", { cache: "no-store" }).then((x) => x.json()).catch(() => ({})),
      fetch("/api/roles", { cache: "no-store" }).then((x) => x.json()).catch(() => ({})),
    ]);
    setWorkflows(w.workflows ?? []); setRuns(r.runs ?? []); setRoleEntries(roles.roles ?? []);
    setSelected((old) => old || w.workflows?.[0]?.id || "");
  }, []);
  useEffect(() => { void load(); }, [load]);
  const workflow = workflows.find((w) => w.id === selected);
  useEffect(() => {
    if (!workflow) return;
    if (lastLoadedId.current === workflow.id) return;
    lastLoadedId.current = workflow.id;
    setYaml(workflow.yaml);
  }, [workflow]);
  const yamlNodes = useMemo(() => {
    const parsed = parseYamlSafe(yaml);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return null;
    const doc = asRecord(parsed.value);
    return Array.isArray(doc.nodes) ? doc.nodes.map(asRecord) : null;
  }, [yaml]);
  const capabilityPolicy = useMemo(() => {
    const parsed = parseYamlSafe(yaml);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return "inherit";
    const defaults = asRecord(asRecord(parsed.value).defaults);
    return defaults.capabilityPolicy === "block" || defaults.capabilityPolicy === "warn" ? defaults.capabilityPolicy : "inherit";
  }, [yaml]);
  const setCapabilityPolicy = (policy: string) => {
    const parsed = parseYamlSafe(yaml);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") { setMessage("YAML не парсится - policy не изменена"); return; }
    const doc = asRecord(parsed.value); const defaults = { ...asRecord(doc.defaults) };
    if (policy === "inherit") delete defaults.capabilityPolicy; else defaults.capabilityPolicy = policy;
    setYaml(YAML.stringify({ ...doc, defaults }, { lineWidth: 0 }));
  };
  // Runtime по умолчанию workflow: шаги с пустым списком кандидатов наследуют этот порядок.
  const workflowRuntimeCandidates = useMemo(() => {
    const parsed = parseYamlSafe(yaml);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return [];
    return asStringList(asRecord(asRecord(asRecord(parsed.value).defaults).runtime).candidates);
  }, [yaml]);
  const setWorkflowRuntimeCandidates = (candidates: string[]) => {
    const parsed = parseYamlSafe(yaml);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") { setMessage("YAML не парсится - runtime не изменён"); return; }
    const doc = asRecord(parsed.value);
    const defaults = { ...asRecord(doc.defaults) };
    if (candidates.length) defaults.runtime = { candidates }; else delete defaults.runtime;
    setYaml(YAML.stringify({ ...doc, defaults }, { lineWidth: 0 }));
  };
  const graphItems = useMemo<Array<StepNode>>(() => {
    if (yamlNodes) {
      return yamlNodes.map((item) => ({
        id: String(item.id),
        title: String(item.title ?? item.id),
        phase: String(item.phase ?? ""),
        roles: asStringList(item.roles),
        dependsOn: asStringList(item.dependsOn),
        ui: item.ui && typeof item.ui === "object" ? item.ui as { x: number; y: number } : undefined,
      }));
    }
    return workflow?.nodes ?? [];
  }, [yamlNodes, workflow]);
  const orderedIds = useMemo(() => graphItems.map((item) => item.id), [graphItems]);
  const rangeIds = useMemo(() => {
    const start = rangeStart ? orderedIds.indexOf(rangeStart) : 0;
    const end = rangeEnd ? orderedIds.indexOf(rangeEnd) : orderedIds.length - 1;
    if (start < 0 || end < 0 || start > end) return null;
    return new Set(orderedIds.slice(start, end + 1));
  }, [orderedIds, rangeStart, rangeEnd]);
  const visibleItems = useMemo(() => (rangeIds ? graphItems.filter((item) => rangeIds.has(item.id)) : graphItems), [graphItems, rangeIds]);
  const nodes = useMemo<Node[]>(() => visibleItems.map((item, index) => ({ id: item.id, type: "workflow", position: item.ui ?? { x: (index % 4) * 250, y: Math.floor(index / 4) * 120 }, data: { item } })), [visibleItems]);
  const anyRunning = useMemo(() => runs.some((r) => r.workflowId === workflow?.id && r.status === "running"), [runs, workflow?.id]);
  const edges = useMemo<Edge[]>(() => visibleItems.flatMap((item) => item.dependsOn.filter((dep) => !rangeIds || rangeIds.has(dep)).map((dep) => ({ id: `${dep}-${item.id}`, source: dep, target: item.id, animated: anyRunning }))), [visibleItems, anyRunning, rangeIds]);
  const roleOptions = useMemo<RoleOption[]>(() => roleEntries.map((role) => ({ value: role.id, label: `${role.title} (${role.id})`, group: role.folder || "без папки" })), [roleEntries]);
  const save = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!workflow) return { ok: false, error: "workflow не выбран" };
    const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", fileName: workflow.fileName, yaml, etag: workflow.etag }) });
    const result = await response.json();
    if (response.status === 409) {
      setConflict({ base: workflow.yaml, current: result.current ?? "", draft: yaml });
      return { ok: false, error: result.error ?? "файл изменён вне Console" };
    }
    if (response.ok) {
      setConflict(null);
      setMessage(result.renamed ? `Сохранено; workflow переименован в ${result.workflow.id}` : "Сохранено");
      lastLoadedId.current = "";
      if (result.workflow?.id && result.workflow.id !== workflow.id) setSelected(result.workflow.id);
      await load();
      return { ok: true };
    }
    setMessage(result.error ?? "Ошибка");
    return { ok: false, error: result.error ?? "Ошибка" };
  };
  const clone = async () => {
    if (!workflow || !cloneNewId.trim()) return;
    const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "clone", sourceId: workflow.id, newId: cloneNewId.trim() }) });
    const result = await response.json(); setMessage(response.ok ? `Создан ${result.workflow.id}` : result.error ?? "Ошибка");
    if (response.ok) { setCloneOpen(false); setCloneNewId(""); await load(); setSelected(result.workflow.id); }
  };
  const applyYamlNodes = (mutate: (nodes: Record<string, unknown>[]) => Record<string, unknown>[] | null): boolean => {
    const parsed = parseYamlSafe(yaml);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return false;
    const doc = asRecord(parsed.value);
    if (!Array.isArray(doc.nodes)) return false;
    const next = mutate(doc.nodes.map(asRecord));
    if (next === null) return false;
    setYaml(YAML.stringify({ ...doc, nodes: next }, { lineWidth: 0 }));
    return true;
  };
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const source = connection.source;
    const target = connection.target;
    const ok = applyYamlNodes((list) => {
      // Артефакт источника: явные outputs или сам узел; он же - вход приёмника.
      const rawOutputs = asStringList(list.find((item) => item.id === source)?.outputs);
      const sourceOutputs = rawOutputs.length ? rawOutputs : [source];
      return list.map((item) => {
        if (item.id === source) {
          return { ...item, outputs: [...new Set([...asStringList(item.outputs), ...sourceOutputs])] };
        }
        if (item.id === target) {
          const inputs = [...new Set([...asStringList(item.inputs), ...sourceOutputs])].filter((name) => name !== target);
          const dependsOn = [...new Set([...asStringList(item.dependsOn), source])];
          return { ...item, dependsOn, inputs };
        }
        return item;
      });
    });
    if (!ok) setMessage("YAML не парсится - связь не добавлена");
  };
  const disconnect = async (edge: Edge) => {
    if (!(await confirmDialog({ title: "Разорвать связь?", message: `Зависимость ${edge.source} → ${edge.target} будет удалена из dependsOn; артефакты источника уберутся из входов приёмника.` }))) return;
    const ok = applyYamlNodes((list) => {
      const sourceOutputs = new Set(asStringList(list.find((item) => item.id === edge.source)?.outputs));
      return list.map((item) => {
        if (item.id === edge.target) {
          const inputs = asStringList(item.inputs).filter((name) => !sourceOutputs.has(name));
          const dependsOn = asStringList(item.dependsOn).filter((dep) => dep !== edge.source);
          return { ...item, dependsOn, inputs };
        }
        return item;
      });
    });
    if (!ok) setMessage("YAML не парсится - связь не удалена");
  };
  const persistPosition = (nodeId: string, position: { x: number; y: number }) => {
    const ok = applyYamlNodes((list) => list.map((item) => (item.id === nodeId ? { ...item, ui: { x: Math.round(position.x), y: Math.round(position.y) } } : item)));
    if (!ok) setMessage("YAML не парсится - позиция не сохранена");
  };
  const createWorkflow = async () => {
    const id = newWfId.trim();
    if (!id || !/^[a-z0-9][a-z0-9:._-]*$/.test(id)) { setMessage("ID workflow обязателен (a-z0-9)"); return; }
    const yamlText = YAML.stringify({ apiVersion: "harness/v1", kind: "Workflow", id, title: newWfTitle.trim() || id, description: "", inputs: {}, defaults: { privacy: "metadata" }, nodes: [] }, { lineWidth: 0 });
    const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", fileName: id.replace(/:/g, ".") + ".yaml", yaml: yamlText }) });
    const result = await response.json();
    setMessage(response.ok ? `Создан ${id}` : result.error ?? "Ошибка");
    if (response.ok) {
      setNewWfOpen(false); setNewWfId(""); setNewWfTitle("");
      lastLoadedId.current = "";
      await load();
      setSelected(id);
    }
  };
  const addNode = () => {
    if (!workflow) return;
    const existing = new Set(graphItems.map((node) => node.id));
    let id = "new-step";
    for (let i = 2; existing.has(id); i += 1) id = `new-step-${i}`;
    const node = {
      id,
      title: "Новый шаг",
      phase: "draft",
      description: "",
      dependsOn: [],
      roles: [],
      runtime: { candidates: [] },
      execution: { prompt: "", confirmPlan: false },
      inputs: [],
      outputs: [],
      timeoutMs: 900_000,
      retry: { maxAttempts: 3 },
      resources: { workspace: "read" },
    };
    const next = spliceEntity(yaml, "nodes", node);
    if (next === null) { setMessage("YAML файла не парсится - шаг не добавлен"); return; }
    setYaml(next);
    setEditorNodeId(id);
    setMessage(`Шаг ${id} добавлен; сохраните YAML кнопкой Validate & save`);
  };
  const deleteNode = async (id: string) => {
    if (!workflow) return;
    if (!(await confirmDialog({ title: `Удалить шаг ${id}?`, message: "Шаг будет удален из YAML, ссылки dependsOn у остальных шагов будут очищены. Изменение станет постоянным после сохранения.", tone: "danger" }))) return;
    const next = removeNodeFromYaml(yaml, id);
    if (next === null) { setMessage("YAML файла не парсится - шаг не удален"); return; }
    setYaml(next);
    setEditorNodeId("");
    setMessage(`Шаг ${id} удален; сохраните YAML кнопкой Validate & save`);
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selected} onChange={setSelected} options={workflows.map((w) => ({ value: w.id, label: `${w.title} (${w.id})` }))} className="w-72" ariaLabel="Workflow" />
      <span className="text-[10px] uppercase text-fg-faint">Стадии</span>
      <Select value={rangeStart} onChange={setRangeStart} options={[{ value: "", label: "start: с начала" }, ...orderedIds.map((id) => ({ value: id, label: "start: " + id }))]} className="w-44" ariaLabel="Начало фильтра" />
      <Select value={rangeEnd} onChange={setRangeEnd} options={[{ value: "", label: "end: до конца" }, ...orderedIds.map((id) => ({ value: id, label: "end: " + id }))]} className="w-44" ariaLabel="Конец фильтра" />
      <Select value={capabilityPolicy} onChange={setCapabilityPolicy} options={[{ value: "inherit", label: "Capabilities: inherit" }, { value: "block", label: "Capabilities: block" }, { value: "warn", label: "Capabilities: warn" }]} className="w-48" ariaLabel="Политика capabilities" />
      <Button onClick={() => setRuntimeOpen(true)}>Runtime workflow{workflowRuntimeCandidates.length ? ": " + workflowRuntimeCandidates[0] + "…" : ""}</Button>
      <Button variant="accent" onClick={addNode}>Добавить шаг</Button>
      <Button variant="accent" onClick={() => setNewWfOpen(true)}>Новый workflow</Button>
      <Button variant="accent" onClick={() => { setCloneNewId(""); setCloneOpen(true); }}>Клонировать</Button>
      <span className="self-center text-xs text-fg-muted">{message}</span>
    </div>
    <div className="h-[480px] overflow-hidden rounded-xl border border-line bg-page">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ workflow: WorkflowCard }}
        onNodeClick={(_, node) => setEditorNodeId(node.id)}
        onConnect={connect}
        onEdgeClick={(_, edge) => void disconnect(edge)}
        onNodeDragStop={(_, node) => persistPosition(node.id, node.position)}
        nodesDraggable
        edgesFocusable
        fitView
      >
        <Background /><Controls />
      </ReactFlow>
    </div>
    {editorNodeId && workflow ? <NodeEditorModal key={editorNodeId} nodeId={editorNodeId} workflow={{ id: workflow.id, title: workflow.title, fileName: workflow.fileName }} yaml={yaml} roleOptions={roleOptions} onYamlChange={setYaml} onRename={(newId) => setEditorNodeId(newId)} onDelete={() => deleteNode(editorNodeId)} onClose={() => setEditorNodeId("")} onSave={save} /> : null}
    {conflict && <section className="rounded-xl border border-warning/50 bg-surface p-3"><h2 className="mb-2 text-sm font-semibold">Конфликт внешнего изменения: base / current / draft</h2><div className="grid gap-2 lg:grid-cols-3">{([['Base', conflict.base], ['Current', conflict.current], ['Draft', conflict.draft]] as const).map(([label, value]) => <label key={label} className="text-[10px] text-fg-muted">{label}<Textarea readOnly value={value} rows={10} className="mt-1 w-full font-mono text-[10px]" /></label>)}</div></section>}
    <Modal open={newWfOpen} onClose={() => setNewWfOpen(false)} title="Новый workflow" description="Создаётся пустой файл; шаги добавляются кнопкой Добавить шаг, связи - мышью на канве." width="max-w-lg" footer={<><Button variant="ghost" onClick={() => setNewWfOpen(false)}>Отмена</Button><Button variant="primary" onClick={createWorkflow}>Создать</Button></>}>
      <div className="space-y-3">
        <Input placeholder="id, например my-flow (a-z0-9)" value={newWfId} onChange={(e) => setNewWfId(e.target.value)} className="w-full font-mono text-xs" />
        <Input placeholder="название (необязательно)" value={newWfTitle} onChange={(e) => setNewWfTitle(e.target.value)} className="w-full text-xs" />
      </div>
    </Modal>
    <Modal open={runtimeOpen} onClose={() => setRuntimeOpen(false)} title={`Runtime workflow: ${workflow?.title ?? ""}`} description="Runtime или провайдер AI SDK по умолчанию; шаги с пустым списком кандидатов наследуют этот порядок failover, шаги со своим списком его переопределяют." width="max-w-lg" footer={<><Button variant="ghost" onClick={() => setRuntimeOpen(false)}>Закрыть</Button></>}>
      <ChipsField
        label="Кандидаты по умолчанию (порядок = порядок failover; перетаскивайте чипы)"
        value={workflowRuntimeCandidates}
        options={runtimeCandidateOptions}
        onChange={setWorkflowRuntimeCandidates}
        addLabel="Добавить runtime или provider:<id>"
        sortable
        emptyHint="Не задан - шаги обязаны иметь собственный список кандидатов"
      />
    </Modal>
    <Modal open={cloneOpen} onClose={() => setCloneOpen(false)} title={`Клонировать: ${workflow?.title ?? ""}`} description="Создаётся наследник через extends; шаги и связи копируются из исходного workflow." width="max-w-lg" footer={<><Button variant="ghost" onClick={() => setCloneOpen(false)}>Отмена</Button><Button variant="primary" disabled={!cloneNewId.trim()} onClick={clone}>Клонировать</Button></>}>
      <Input placeholder="id копии, например sdlc:team" value={cloneNewId} onChange={(e) => setCloneNewId(e.target.value)} className="w-full font-mono text-xs" />
    </Modal>
    <div className="grid gap-4 lg:grid-cols-2"><section><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">YAML</h2><Button onClick={save}>Validate &amp; save</Button></div><Textarea value={yaml} onChange={(e) => setYaml(e.target.value)} rows={24} className="w-full font-mono text-[11px]" /></section><section><h2 className="mb-2 text-sm font-semibold">Запуски</h2><div className="space-y-2">{runs.map((run) => <a key={run.id} href={`/workflows/runs/${run.id}`} className="block rounded-lg border border-line bg-surface p-3"><div className="flex justify-between text-xs"><span>{run.title}</span><span className="text-info">{run.status}</span></div><div className="mt-1 font-mono text-[10px] text-fg-faint">{run.id}</div></a>)}</div></section></div>
  </div>;
}
