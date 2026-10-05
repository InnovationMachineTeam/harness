import { NextResponse } from "next/server";
import { homedir } from "node:os";
import { collectHarnessSkills, skillEffective } from "@/core/skills";
import { loadInternalSkills, loadRoles, loadWorkflowCatalog } from "@/core/workflows/catalog";
import { internalSkillsForExecutor } from "@/core/workflows/skills";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { workspaceDirs } from "@/core/state";
import { fsSignals } from "@/lib/signals/fs";
import { serverContext } from "@/lib/server-context";
import type { SkillItem } from "@/core/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/slash-menu?executor=<id>&workflowId=<id>&workspace=<dir> - данные
 * меню slash-команд и @-файлов вкладки "Агент". Группы:
 * - runtimeSkills: навыки, установленные в каталогах рантайма-исполнителя
 *   (включая глобальные); вызов - нативный "/<name>";
 * - sharedSkills: публичные harness-навыки (publicSkills из конфига) с
 *   эффективным значением тоггла; вызов - нативный "/<name>";
 * - internalSkills: master-навыки (мастер-каталог), привязанные к исполнителю
 *   и включённые для него; вызов - "/master:<id>";
 * - agents: роли .agents/roles; вызов - "/agent:<id>" (direct-режим);
 * - workflows: каталог workflow; вызов - "/workflow:<id>" (direct-режим);
 * - workflowSkills: master skills ролей выбранного workflow (режим workflow).
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const executor = params.get("executor") ?? "";
  const workflowId = params.get("workflowId") ?? "";
  if (!executor) return NextResponse.json({ error: "укажите ?executor=" }, { status: 400 });

  const probeCtx = { repoRoot: ctx.repoRoot, home: homedir(), fs: fsSignals, workspaces: workspaceDirs(ctx.state) };

  const toMenuItem = (item: SkillItem) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    source: item.source,
    description: item.description ?? "",
  });

  let runtimeSkills: ReturnType<typeof toMenuItem>[] = [];
  const adapter = ctx.adapters[executor];
  if (adapter?.listSkills) {
    runtimeSkills = (await adapter.listSkills(probeCtx).catch(() => [] as SkillItem[])).map(toMenuItem);
  }
  const sharedSkills = (await collectHarnessSkills(probeCtx))
    .filter((item) => skillEffective(ctx.state, item.id, executor))
    .map(toMenuItem);

  const internalCatalog = workflowId && workflowId !== "direct" ? await loadInternalSkills(ctx.repoRoot) : null;
  const internalEntries = internalCatalog ?? await internalSkillsForExecutor(ctx.repoRoot, executor);
  // выключенный для исполнителя internal-навык в меню не попадает; тоггл зависит от группы:
  // design-навыки хранятся с префиксом "design:", мастер-навыки - "master:"
  const internalToggleId = (item: { group: string; value: { id: string } }): string =>
    (item.group === "design" ? "design:" : "master:") + item.value.id;
  const internalSkills = internalEntries.filter((item) =>
    internalCatalog ? true : skillEffective(ctx.state, internalToggleId(item), executor),
  );
  const agents = (await loadRoles(ctx.repoRoot)).map((role) => ({
    id: role.value.id,
    title: role.value.title,
    folder: role.folder,
    skills: role.value.skills,
    description: role.body.split("\n").find((line) => line.trim() && !line.trim().startsWith("#"))?.trim().slice(0, 140) ?? "",
  }));

  const workflowCatalog = await loadWorkflowCatalog(ctx.repoRoot, resolveWorkflowWorkspace(ctx.state, params.get("workspace")));
  const workflows = [...workflowCatalog.values()].map((entry) => ({ id: entry.value.id, title: entry.value.title, nodeCount: entry.value.nodes.length }));

  let workflowSkills: Array<{ id: string; title: string; description: string }> = [];
  if (internalCatalog && workflowId) {
    try {
      const workflow = workflowCatalog.get(workflowId)?.value;
      const roleIds = [...new Set((workflow?.nodes ?? []).flatMap((node) => [...node.roles, ...(node.inputControl?.roles ?? []), ...(node.outputControl?.roles ?? [])]))];
      const roleById = new Map((await loadRoles(ctx.repoRoot)).map((role) => [role.value.id, role]));
      const wfSkillIds = [...new Set(roleIds.flatMap((id) => roleById.get(id)?.value.skills ?? []))];
      workflowSkills = internalCatalog
        .filter((item) => wfSkillIds.includes(item.value.id))
        .map((item) => ({ id: item.value.id, title: item.value.title, description: item.value.description }));
    } catch {
      /* workflow недоступен - группа остаётся пустой */
    }
  }

  return NextResponse.json({
    runtimeSkills,
    sharedSkills,
    internalSkills: internalSkills.map((item) => ({ id: item.value.id, title: item.value.title, description: item.value.description, tags: item.value.tags, group: item.group })),
    agents,
    workflows,
    workflowSkills,
  });
}
