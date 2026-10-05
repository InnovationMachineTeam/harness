import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { loadInternalSkills, loadRoles } from "./catalog";
import type { ConsoleState } from "../state";
import type { WorkflowDefinition, WorkflowStep } from "./schema";
import { ADAPTERS } from "@/runtimes";
import { fsSignals } from "@/lib/signals/fs";
import { runtimeModelForTier } from "../prompts";
import { isMandatoryWorkspace, workspaceDirs } from "../state";
import { detectToolCli, effectiveToolState, toolById, TOOLS } from "../tools";
import { resolveProviderCandidate } from "../agentTools";
import { parseTaskProviderId, type ModelTier, type ProviderEntry } from "../providers";

export type CapabilityPolicy = "block" | "warn";
export type CapabilityKind = "skill" | "mcp" | "tool";

export interface PreflightIssue {
  code: "runtime" | "model" | "role" | "skill" | "mcp" | "tool" | "workspace";
  severity: "error" | "warning";
  capabilityKind?: CapabilityKind;
  capabilityId?: string;
  roleId?: string;
  stepId: string | null;
  message: string;
  replacements: string[];
}

export interface PreflightResult {
  ok: boolean;
  policy: CapabilityPolicy;
  issues: PreflightIssue[];
}

export function resolveCapabilityPolicy(workflow: WorkflowDefinition, workspaceDir: string, state: ConsoleState): CapabilityPolicy {
  return workflow.defaults.capabilityPolicy
    ?? state.settings.workflows.capabilities.workspacePolicies[workspaceDir]
    ?? state.settings.workflows.capabilities.defaultPolicy
    ?? "block";
}

/** Эффективный tier шага: узел → defaultTier первой роли → standard. */
function effectiveTier(node: WorkflowStep, roleTier: (id: string) => string | undefined): string {
  return node.runtime.tier ?? node.roles.map((id) => roleTier(id)).find(Boolean) ?? "standard";
}

/** Привязка internal-навыка к кандидатам исполнения: прямой id, "provider" покрывает provider:<id>. */
function skillBoundToCandidates(runtimes: string[] | undefined, candidates: string[]): boolean {
  return Boolean(runtimes?.some((id) =>
    candidates.includes(id) ||
    (id === "provider" && candidates.some((candidate) => parseTaskProviderId(candidate) !== null)),
  ));
}

export async function workflowPreflight(opts: {
  repoRoot: string;
  workspaceDir: string;
  workflow: WorkflowDefinition;
  state: ConsoleState;
  selectedNodes?: string[];
  /** Run-уровневые internal skills (/skill: из запроса запуска). */
  runSkillIds?: string[];
}): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];
  const policy = resolveCapabilityPolicy(opts.workflow, opts.workspaceDir, opts.state);
  const systemIssue = (issue: Omit<PreflightIssue, "severity">) => issues.push({ ...issue, severity: "error" });
  const capabilityIssue = (kind: CapabilityKind, roleId: string, stepId: string, id: string, message: string, replacements: string[]) => issues.push({
    code: kind, severity: policy === "block" ? "error" : "warning", capabilityKind: kind,
    capabilityId: id, roleId, stepId, message, replacements,
  });
  try {
    await access(opts.workspaceDir, constants.R_OK);
  } catch {
    systemIssue({ code: "workspace", stepId: null, message: "рабочая папка недоступна", replacements: [] });
  }
  const selected = opts.selectedNodes?.length ? new Set(opts.selectedNodes) : null;
  // Дополнительная рабочая папка - read mode: write-ресурсы узлов исполняются как read.
  if (!isMandatoryWorkspace(opts.state, opts.workspaceDir)) {
    const writeNodes = opts.workflow.nodes
      .filter((node) => (!selected || selected.has(node.id)) && node.resources.workspace === "write")
      .map((node) => node.id);
    if (writeNodes.length) {
      issues.push({
        code: "workspace", severity: "warning", stepId: null,
        message: "прогон в дополнительной рабочей папке - режим только чтение; write-ресурсы узлов исполняются как read: " + writeNodes.join(", "),
        replacements: [],
      });
    }
  }
  const roles = await loadRoles(opts.repoRoot);
  const roleById = new Map(roles.map((role) => [role.value.id, role]));
  const roleTier = (id: string) => roleById.get(id)?.value.defaultTier;
  const internalSkills = await loadInternalSkills(opts.repoRoot);
  const skillIds = new Set(internalSkills.map((item) => item.value.id));
  const runtimeIds = new Set(Object.keys(ADAPTERS));
  const probeContext = { repoRoot: opts.repoRoot, home: homedir(), fs: fsSignals, workspaces: workspaceDirs(opts.state) };
  const installedEntries = await Promise.all(Object.entries(ADAPTERS).map(async ([id, adapter]) => [id, adapter.isInstalled ? await adapter.isInstalled(probeContext).catch(() => false) : true] as const));
  const installedRuntimes = new Set(installedEntries.filter(([, installed]) => installed).map(([id]) => id));
  for (const node of opts.workflow.nodes) {
    if (selected && !selected.has(node.id)) continue;
    const stepRoles = [...new Set([...node.roles, ...(node.inputControl?.roles ?? []), ...(node.outputControl?.roles ?? [])])];
    for (const roleId of stepRoles) {
      if (!roleById.has(roleId)) systemIssue({ code: "role", stepId: node.id, message: "роль не найдена: " + roleId, replacements: [...roleById.keys()] });
    }
    // Кандидаты шага: явный список или наследование defaults.runtime workflow.
    const stepCandidates = node.runtime.candidates.length ? node.runtime.candidates : opts.workflow.defaults.runtime?.candidates ?? [];
    if (stepCandidates.length > 0) {
      const compatible = stepCandidates.filter((id) => runtimeIds.has(id) && installedRuntimes.has(id));
      // Провайдер-кандидаты ("provider:<id>"): пресет существует и запись активна.
      const providerUsable: Array<{ id: string; entry: ProviderEntry }> = [];
      let providerError: string | null = null;
      for (const candidate of stepCandidates) {
        const resolved = await resolveProviderCandidate(opts.repoRoot, candidate, opts.state);
        if (resolved.ok) providerUsable.push({ id: candidate, entry: resolved.candidate.entry });
        else if (resolved.error) providerError = resolved.error;
      }
      if (compatible.length === 0 && providerUsable.length === 0) {
        systemIssue({
          code: "runtime", stepId: node.id,
          message: providerError ?? "нет установленного совместимого runtime",
          replacements: [...installedRuntimes, ...stepCandidates.filter((id) => parseTaskProviderId(id))],
        });
      } else {
        const tier = effectiveTier(node, roleTier);
        const withModel: string[] = [];
        for (const runtime of compatible) {
          const model = await runtimeModelForTier(opts.repoRoot, runtime, tier);
          if (model && model.verified !== false) withModel.push(runtime);
        }
        for (const provider of providerUsable) {
          if (provider.entry.models[tier as ModelTier]?.trim()) withModel.push(provider.id);
        }
        if (!withModel.length) systemIssue({ code: "model", stepId: node.id, message: `нет модели tier ${tier}`, replacements: [...compatible, ...providerUsable.map((provider) => provider.id)] });
      }
    }
    for (const roleId of stepRoles) {
      const role = roleById.get(roleId);
      if (!role) continue;
      const candidates = stepCandidates;
      for (const skill of role.value.skills) {
        const manifest = internalSkills.find((item) => item.value.id === skill);
        if (!skillIds.has(skill) || (candidates.length && !skillBoundToCandidates(manifest?.value.runtimes, candidates))) {
          capabilityIssue("skill", roleId, node.id, skill, "internal skill роли " + roleId + " недоступен: " + skill, [...skillIds]);
        }
      }
      for (const mcp of role.value.mcp) {
        const server = opts.state.mcp.servers[mcp];
        const usable = server && (candidates.length === 0 || candidates.some((runtime) => server.runtimeOverrides?.[runtime] ?? server.enabled));
        if (!usable) capabilityIssue("mcp", roleId, node.id, mcp, "MCP роли " + roleId + " недоступен: " + mcp, Object.keys(opts.state.mcp.servers));
      }
      for (const toolId of role.value.tools) {
        const tool = toolById(toolId);
        const toolState = tool ? effectiveToolState(tool, opts.state, homedir(), opts.repoRoot) : "missing";
        const usable = Boolean(tool && detectToolCli(tool.bin).installed && toolState !== "off");
        if (!usable) capabilityIssue("tool", roleId, node.id, toolId, "tool роли " + roleId + " недоступен: " + toolId, TOOLS.map((item) => item.id));
      }
    }
  }
  // Run-уровневые навыки запроса запуска: без привязки к роли; доступность
  // проверяется по объединению runtime-кандидатов выбранных узлов.
  const runSkillIds = opts.runSkillIds ?? [];
  if (runSkillIds.length) {
    const selectedCandidates = [...new Set(opts.workflow.nodes
      .filter((node) => !selected || selected.has(node.id))
      .flatMap((node) => node.runtime.candidates.length ? node.runtime.candidates : opts.workflow.defaults.runtime?.candidates ?? []))];
    for (const id of runSkillIds) {
      const manifest = internalSkills.find((item) => item.value.id === id);
      if (!skillIds.has(id)) {
        capabilityIssue("skill", "", "*", id, "internal skill запроса запуска не найден: " + id, [...skillIds]);
        continue;
      }
      if (selectedCandidates.length && !skillBoundToCandidates(manifest?.value.runtimes, selectedCandidates)) {
        capabilityIssue("skill", "", "*", id, "internal skill запроса запуска недоступен исполнителям узлов: " + id, [...skillIds]);
      }
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), policy, issues };
}
