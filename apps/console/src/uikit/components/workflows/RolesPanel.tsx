"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, confirmDialog, Input, Modal, Select } from "@/uikit";
import { RoleEditorModal, type ChipOption } from "./RoleEditorModal";

type Role = {
  id: string;
  title: string;
  domain?: string;
  skills: string[];
  mcp: string[];
  folder: string;
  body: string;
  text: string;
  fileName: string;
  etag: string;
};

/** Визард создания роли: папка (существующая или новая), id, название. */
function CreateRoleWizard({ open, folders, onClose, onCreated }: {
  open: boolean;
  folders: string[];
  onClose: () => void;
  onCreated: (folder: string, id: string) => Promise<void>;
}) {
  const [folderMode, setFolderMode] = useState("__existing__");
  const [folder, setFolder] = useState(folders[0] ?? "");
  const [newFolder, setNewFolder] = useState("");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFolderMode(folders.length ? "__existing__" : "__new__");
      setFolder(folders[0] ?? "");
      setNewFolder("");
      setId("");
      setTitle("");
      setError("");
    }
  }, [open, folders]);

  const targetFolder = folderMode === "__new__" ? newFolder.trim() : folder;
  const canCreate = Boolean(targetFolder) && /^[a-z0-9][a-z0-9._-]*$/.test(id.trim());

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      await onCreated(targetFolder, id.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    open={open}
    onClose={onClose}
    title="Новая роль"
    description="Роль - файл .agents/roles/<папка>/<id>.md: frontmatter и markdown-инструкции. Скелет секций создастся автоматически."
    width="max-w-lg"
    footer={<>
      <Button variant="ghost" onClick={onClose}>Отмена</Button>
      <Button variant="primary" disabled={!canCreate || busy} onClick={create}>{busy ? "Создание…" : "Создать"}</Button>
    </>}
  >
    <div className="space-y-3">
      <label className="block"><span className="text-xs text-fg-faint">Папка</span>
        <Select
          value={folderMode}
          onChange={setFolderMode}
          options={[...folders.map((name) => ({ value: name, label: name })), { value: "__new__", label: "Новая папка…" }]}
          className="mt-1 w-full"
          ariaLabel="Папка роли"
        />
      </label>
      {folderMode === "__new__" ? <Input placeholder="имя папки, например research" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} className="w-full font-mono text-xs" /> : null}
      <Input placeholder="id роли, например data-analyst" value={id} onChange={(e) => setId(e.target.value)} className="w-full font-mono text-xs" />
      <Input placeholder="название роли (необязательно)" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-xs" />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  </Modal>;
}

export function RolesPanel() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [folder, setFolder] = useState("");
  const [message, setMessage] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editorRoleId, setEditorRoleId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [skillOptions, setSkillOptions] = useState<ChipOption[]>([]);
  const [mcpOptions, setMcpOptions] = useState<ChipOption[]>([]);
  const [toolOptions, setToolOptions] = useState<ChipOption[]>([]);

  const load = () => fetch("/api/roles").then((r) => r.json()).then((j) => {
    const loaded: Role[] = j.roles ?? [];
    setRoles(loaded);
    setFolder((old) => (old && (old === "__all__" || loaded.some((role) => role.folder === old)) ? old : "__all__"));
  });
  useEffect(() => {
    void load();
    // Опции чипов frontmatter: навыки, MCP-серверы и инструменты реестра.
    void fetch("/api/skills/all").then((r) => r.json()).then((j) => setSkillOptions(((j.items ?? []) as Array<{ name: string; label: string; description?: string }>).filter((skill: { label: string }) => skill.label === "internal").map((skill: { name: string; description?: string }) => ({ value: skill.name, label: skill.description ? `${skill.name} - ${skill.description}` : skill.name })))).catch(() => undefined);
    void fetch("/api/mcp").then((r) => r.json()).then((j) => setMcpOptions((j.servers ?? []).map((server: { name?: string }) => ({ value: String(server.name ?? ""), label: String(server.name ?? "") })).filter((option: ChipOption) => option.value))).catch(() => undefined);
    void fetch("/api/tools/ids").then((r) => r.json()).then((j) => setToolOptions((j.tools ?? []).map((tool: { id: string; title?: string }) => ({ value: tool.id, label: tool.title ? `${tool.title} (${tool.id})` : tool.id })))).catch(() => undefined);
  }, []);

  const folders = useMemo(() => [...new Set(roles.map((role) => role.folder))].filter(Boolean).sort(), [roles]);
  const visible = useMemo(() => (folder === "__all__" ? roles : roles.filter((role) => role.folder === folder)), [roles, folder]);
  const editorRole = roles.find((role) => role.id === editorRoleId);

  const saveRole = async (role: Role, text: string): Promise<{ ok: boolean; error?: string }> => {
    const r = await fetch("/api/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", folder: role.folder, id: role.id, text, etag: role.etag }) });
    const j = await r.json();
    setMessage(r.ok ? "Сохранено" : j.error ?? "Ошибка");
    if (r.ok) { void load(); return { ok: true }; }
    return { ok: false, error: j.error ?? "Ошибка" };
  };

  const createRole = async (targetFolder: string, id: string) => {
    const r = await fetch("/api/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", folder: targetFolder, id }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Ошибка создания роли");
    setMessage(`Роль ${id} создана`);
    await load();
    setWizardOpen(false);
    if (targetFolder) setFolder(targetFolder);
    setEditorRoleId(id);
  };

  const deleteRole = async (role: Role) => {
    if (!(await confirmDialog({ title: `Удалить роль ${role.id}?`, message: `Файл .agents/roles/${role.folder ? role.folder + "/" : ""}${role.id}.md будет удалён.`, tone: "danger" }))) return;
    const r = await fetch("/api/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", folder: role.folder, id: role.id, etag: role.etag }) });
    const j = await r.json();
    setMessage(r.ok ? `Роль ${role.id} удалена` : j.error ?? "Ошибка удаления");
    if (r.ok) { setEditorRoleId(""); await load(); }
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-2">
      <Select value={folder} onChange={setFolder} options={[{ value: "__all__", label: "Все папки" }, ...folders.map((name) => ({ value: name, label: name }))]} className="w-56" ariaLabel="Папка ролей" />
      <Button variant="accent" onClick={() => setWizardOpen(true)}>Добавить роль</Button>
      <span className="text-xs text-fg-muted">{message}</span>
    </div>
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{visible.map((role) => <article key={role.id} title="Открыть редактор роли" onClick={() => setEditorRoleId(role.id)} className="cursor-pointer rounded-xl border border-line bg-surface p-3 transition-colors hover:border-info"><div className="text-sm font-semibold">{role.title}</div><div className="font-mono text-[10px] text-fg-faint">{role.folder ? role.folder + "/" : ""}{role.id}</div><p className="mt-2 text-xs text-fg-muted">{role.body.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.slice(0, 120) ?? "Инструкции роли не заполнены"}</p>{role.skills.length ? <p className="mt-2 text-[10px] text-info">skills: {role.skills.join(", ")}</p> : null}<p className="mt-2 text-[10px] text-info">Редактировать</p></article>)}</div>
    <CreateRoleWizard open={wizardOpen} folders={folders} onClose={() => setWizardOpen(false)} onCreated={createRole} />
    {editorRole ? <RoleEditorModal
      key={editorRole.id}
      roleId={editorRole.id}
      folder={editorRole.folder}
      skillOptions={skillOptions}
      mcpOptions={mcpOptions}
      toolOptions={toolOptions}
      text={drafts[editorRole.id] ?? editorRole.text}
      onTextChange={(next) => setDrafts((old) => ({ ...old, [editorRole.id]: next }))}
      onDelete={() => deleteRole(editorRole)}
      onClose={() => { setEditorRoleId(""); setDrafts((old) => { const next = { ...old }; delete next[editorRole.id]; return next; }); }}
      onSave={() => saveRole(editorRole, drafts[editorRole.id] ?? editorRole.text)}
    /> : null}
  </div>;
}
