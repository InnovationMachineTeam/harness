"use client";
import { useEffect, useState } from "react";
import { Button, Input, Notice, Panel, Select } from "@/uikit";
type CapabilityPolicy = "block" | "warn";
type Settings = { privacy: "full" | "metadata" | "aggregates"; capabilities: { defaultPolicy: CapabilityPolicy; workspacePolicies: Record<string, CapabilityPolicy> }; designProviders: Record<string, string[]>; subscription: { name: string; price: number; currency: string; period: string } | null };
export function WorkflowSettingsPanel() {
  const [value, setValue] = useState<Settings | null>(null); const [message, setMessage] = useState(""); const [workspaces, setWorkspaces] = useState<string[]>([]);
  useEffect(() => { void fetch("/api/settings").then((r) => r.json()).then((j) => { setValue(j.workflowSettings); setWorkspaces(j.workspaces ?? []); }); }, []);
  if (!value) return <p className="text-xs text-fg-muted">Загрузка...</p>;
  const save = async () => { const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowSettings: value }) }); setMessage(r.ok ? "Сохранено" : "Ошибка сохранения"); };
  const setWorkspacePolicy = (workspace: string, policy: string) => {
    const workspacePolicies = { ...value.capabilities.workspacePolicies };
    if (policy === "inherit") delete workspacePolicies[workspace]; else workspacePolicies[workspace] = policy as CapabilityPolicy;
    setValue({ ...value, capabilities: { ...value.capabilities, workspacePolicies } });
  };
  const policyOptions = [{ value: "block", label: "Block step" }, { value: "warn", label: "Warn and continue" }];
  return <div className="space-y-3">
    <Panel title="Privacy analytics"><p className="mb-2 text-xs text-fg-muted">Наследование: global → workspace → workflow. Checkpoints содержат минимальное операционное состояние независимо от режима.</p><Select value={value.privacy} onChange={(privacy) => setValue({ ...value, privacy: privacy as Settings["privacy"] })} options={["full", "metadata", "aggregates"].map((x) => ({ value: x, label: x }))} className="w-48" /></Panel>
    <Panel title="Недоступные capabilities"><p className="mb-3 text-xs text-fg-muted">Политика применяется к skills, MCP и tools. Приоритет: workflow → workspace → global. Warn запускает шаг с fallback и записывает предупреждение в run.</p><div className="mb-3 flex items-center gap-3 text-xs"><span className="w-40">Global default</span><Select value={value.capabilities.defaultPolicy} onChange={(defaultPolicy) => setValue({ ...value, capabilities: { ...value.capabilities, defaultPolicy: defaultPolicy as CapabilityPolicy } })} options={policyOptions} className="w-52" /></div><div className="space-y-2">{workspaces.map((workspace) => <div key={workspace} className="grid gap-2 text-xs md:grid-cols-[1fr_210px]"><span className="truncate font-mono text-[10px]" title={workspace}>{workspace}</span><Select value={value.capabilities.workspacePolicies[workspace] ?? "inherit"} onChange={(policy) => setWorkspacePolicy(workspace, policy)} options={[{ value: "inherit", label: "Inherit global" }, ...policyOptions]} /></div>)}</div></Panel>
    <Panel title="Design providers"><div className="space-y-2">{Object.entries(value.designProviders).map(([runtime, providers]) => <div key={runtime} className="grid grid-cols-[100px_1fr] items-center text-xs"><span>{runtime}</span><Input value={providers.join(", ")} onChange={(e) => setValue({ ...value, designProviders: { ...value.designProviders, [runtime]: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></div>)}</div></Panel>
    <Notice tone="info">Подписки и Pay as You Go перенесены в рантаймы: страница рантайма, вкладка «Подписки»; у провайдеров - кнопка-иконка на карточке.</Notice>
    <div className="flex items-center gap-2"><Button variant="primary" onClick={save}>Сохранить</Button><span className="text-xs text-fg-muted">{message}</span></div>
  </div>;
}
