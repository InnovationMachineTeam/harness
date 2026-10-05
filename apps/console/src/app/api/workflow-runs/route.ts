import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadInternalSkills, loadRoles, loadWorkflowCatalog, partialNodeClosure, workflowNodeRange } from "@/core/workflows/catalog";
import { parsePromptCommands, parseWorkflowInvocation, scoreSkill } from "@/core/workflows/skills";
import { workflowSchema, type WorkflowStep } from "@/core/workflows/schema";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { workflowPreflight } from "@/core/workflows/preflight";
import { WorkflowStore } from "@/core/workflows/storage";
import { ensureWorkflowWorker, workflowWorkerStatus } from "@/core/workflows/worker";
import { isActiveProvider, MODEL_TIERS, parseTaskProviderId, providerPresetById } from "@/core/providers";
import { readProviderEntry } from "@/core/providerSettings";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

function stepRoleIds(nodes: WorkflowStep[]): string[] {
  return [...new Set(nodes.flatMap((node) => [...node.roles, ...(node.inputControl?.roles ?? []), ...(node.outputControl?.roles ?? [])]))];
}

export async function GET(request: Request) {
  const ctx = await serverContext();
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const runs = store.listRuns(100);
    store.close();
    return NextResponse.json({ workspace, runs, worker: await workflowWorkerStatus(ctx.repoRoot) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as {
    workspace?: string;
    workflowId?: string;
    title?: string;
    targetNodes?: string[];
    startNodeId?: string;
    endNodeId?: string;
    input?: Record<string, unknown>;
    roadmapItemId?: string;
    forkFromRunId?: string;
  } | null;
  try {
    if (body?.forkFromRunId) {
      const workspace = resolveWorkflowWorkspace(ctx.state, body.workspace);
      const store = new WorkflowStore(ctx.repoRoot, workspace);
      const source = store.getRun(body.forkFromRunId);
      if (!source) { store.close(); throw new Error("исходный run не найден"); }
      const run = store.createRun({
        workspaceDir: workspace,
        workflow: source.snapshot,
        title: body.title?.trim() || source.title + " - fork",
        targetNodes: body.targetNodes ?? source.targetNodes,
        values: body.input ?? source.input,
        privacy: source.privacy,
        roadmapItemId: body.roadmapItemId ?? source.roadmapItemId,
      });
      store.appendEvent(run.id, "run.forked", { sourceRunId: source.id });
      store.close();
      const worker = await ensureWorkflowWorker(ctx.repoRoot);
      return NextResponse.json({ run, worker }, { status: 201 });
    }
    if (!body?.workflowId) throw new Error("workflowId обязателен");
    const workspace = resolveWorkflowWorkspace(ctx.state, body.workspace);
    const catalog = await loadWorkflowCatalog(ctx.repoRoot, workspace);
    const workflow = catalog.get(body.workflowId)?.value;
    if (!workflow) throw new Error("workflow не найден: " + body.workflowId);
    // Slash-команды запроса запуска: /master:<id> - run-уровневые навыки;
    // /agent: и /workflow: в запросе workflow запрещены - агенты выбираются
    // в узлах, workflow запускается селектором или /workflow:<id> в direct-режиме.
    const rawRequest = typeof body.input?.request === "string" ? body.input.request : "";
    const commands = rawRequest ? parsePromptCommands(rawRequest) : null;
    if (commands?.agentIds.length) {
      throw new Error("агенты передаются в workflow только через узлы: уберите /agent: из запроса запуска");
    }
    if (parseWorkflowInvocation(rawRequest)) {
      throw new Error("workflow не запускается из запроса workflow: уберите /workflow: из запроса запуска");
    }
    let runSkillIds = commands?.skillIds ?? [];
    if (commands?.autoSkill) {
      const internal = await loadInternalSkills(ctx.repoRoot);
      const best = [...internal].sort((a, b) =>
        scoreSkill(commands.prompt, b.value.tags, b.value.description) - scoreSkill(commands.prompt, a.value.tags, a.value.description),
      )[0];
      if (best) runSkillIds = [best.value.id];
    }
    const hasRange = Boolean(body.startNodeId || body.endNodeId);
    const targetNodes = hasRange
      ? workflowNodeRange(workflow, body.startNodeId, body.endNodeId)
      : body.targetNodes?.length ? partialNodeClosure(workflow, body.targetNodes) : [];
    const preflight = await workflowPreflight({ repoRoot: ctx.repoRoot, workspaceDir: workspace, workflow, state: ctx.state, selectedNodes: targetNodes, runSkillIds });
    if (!preflight.ok) return NextResponse.json({ error: "preflight не пройден", preflight }, { status: 409 });
    const selectedSteps = workflow.nodes.filter((node) => !targetNodes.length || targetNodes.includes(node.id));
    const roleIds = stepRoleIds(selectedSteps);
    const [roles, skills] = await Promise.all([loadRoles(ctx.repoRoot), loadInternalSkills(ctx.repoRoot)]);
    const usedRoles = roles.filter((role) => roleIds.includes(role.value.id));
    const unavailableCapabilities = preflight.issues.filter((issue) => issue.severity === "warning" && issue.capabilityKind && issue.capabilityId).map((issue) => ({
      kind: issue.capabilityKind!, id: issue.capabilityId!, roleId: issue.roleId ?? "", stepId: issue.stepId ?? "", reason: issue.message,
    }));
    const unavailableSkills = new Set(unavailableCapabilities.filter((item) => item.kind === "skill").map((item) => item.id));
    // Навыки прогона: run-уровневые (/skill: запроса) + навыки ролей выбранных узлов.
    const skillIds = [...new Set([...runSkillIds, ...usedRoles.flatMap((role) => role.value.skills)])].filter((id) => !unavailableSkills.has(id));
    const runtimeIds = [...new Set(workflow.nodes.flatMap((node) => node.runtime.candidates.length ? node.runtime.candidates : workflow.defaults.runtime?.candidates ?? []))];
    const runtimes = Object.fromEntries((await Promise.all(runtimeIds.map(async (runtimeId) => {
      // Провайдер-кандидат: модели tier замораживаются из записи провайдера.
      const providerId = parseTaskProviderId(runtimeId);
      if (providerId) {
        const preset = providerPresetById(providerId);
        if (!preset) return null;
        const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[providerId] ?? null);
        const active = isActiveProvider(preset, entry);
        const models = Object.fromEntries(MODEL_TIERS.flatMap((tier) => entry.models[tier]?.trim() ? [[tier, { model: entry.models[tier].trim(), thinkingLevel: "", verified: active }]] : []));
        return [runtimeId, { configHash: createHash("sha256").update(JSON.stringify({ baseUrl: entry.baseUrl, models: entry.models })).digest("hex"), models }] as const;
      }
      try {
        const raw = await readFile(`${ctx.repoRoot}/.agents/runtime/${runtimeId}/config.json`, "utf8");
        const config = JSON.parse(raw) as { models?: Record<string, { model?: string; thinkingLevel?: string; verified?: boolean }> };
        const models = Object.fromEntries(Object.entries(config.models ?? {}).flatMap(([tier, value]) => value.model ? [[tier, { model: value.model, thinkingLevel: value.thinkingLevel ?? "", verified: value.verified }]] : []));
        return [runtimeId, { configHash: createHash("sha256").update(raw).digest("hex"), models }] as const;
      } catch {
        return null;
      }
    }))).filter((item): item is NonNullable<typeof item> => item !== null));
    const snapshot = workflowSchema.parse({
      ...workflow,
      resolution: {
        at: new Date().toISOString(),
        capabilityPolicy: preflight.policy,
        unavailableCapabilities,
        roles: Object.fromEntries(usedRoles.map((role) => [role.value.id, {
          hash: role.etag, content: role.body, title: role.value.title,
          skills: role.value.skills, mcp: role.value.mcp, tools: role.value.tools,
          defaultTier: role.value.defaultTier, defaultEffort: role.value.defaultEffort,
        }])),
        skills: Object.fromEntries(skills.filter((item) => skillIds.includes(item.value.id)).map((item) => [item.value.id, { version: item.value.source.version, hash: item.value.source.hash, content: item.content }])),
        runtimes,
      },
    });
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    // Запрос прогона хранится без командных токенов; run-уровневые навыки -
    // списком masterSkills (движок объединяет их с навыками ролей узла).
    const runInput: Record<string, unknown> = { ...(body.input ?? {}) };
    if (commands) runInput.request = commands.prompt;
    runInput.masterSkills = skillIds.filter((id) => runSkillIds.includes(id));
    const run = store.createRun({
      workspaceDir: workspace,
      workflow: snapshot,
      title: body.title?.trim() || workflow.title,
      targetNodes,
      values: runInput,
      privacy: workflow.defaults.privacy ?? ctx.state.settings.workflows.workspacePrivacy[workspace] ?? ctx.state.settings.workflows.privacy,
      roadmapItemId: body.roadmapItemId ?? null,
    });
    for (const warning of preflight.issues.filter((issue) => issue.severity === "warning")) {
      store.appendEvent(run.id, "run.preflight-warning", { ...warning }, { stepId: warning.stepId ?? undefined });
    }
    store.close();
    const worker = await ensureWorkflowWorker(ctx.repoRoot);
    return NextResponse.json({ run, preflight, worker }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
