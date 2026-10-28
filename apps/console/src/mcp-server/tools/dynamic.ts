import path from "node:path";
import { z } from "zod";
import { findRepoRoot } from "@/core/repo";
import { loadConsoleState, workspaceDirs } from "@/core/state";
import { loadWorkflowCatalog } from "@/core/workflows/catalog";
import { exposedWorkspaces, type HarnessMcpConfig } from "../config";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Потолок динамических инструментов (модель видит конечный список). */
export const MAX_DYNAMIC_TOOLS = 30;

/**
 * Динамические инструменты из рабочих папок: каждый workflow экспонированной
 * папки становится отдельным инструментом workflow_<id> (описание - из YAML).
 * Набор пересобирается при обновлении набора инструментов сервера. Коллизия
 * идентификаторов между папками разрешается суффиксом __<имя папки>.
 */
export async function buildDynamicWorkflowTools(
  config: HarnessMcpConfig,
  actions: HarnessMcpActions,
  repoRoot = findRepoRoot(),
): Promise<ToolSpec[]> {
  if (!config.workflowTools.enabled) return [];
  const state = await loadConsoleState(repoRoot);
  const dirs = exposedWorkspaces(config, workspaceDirs(state));
  const allow = config.workflowTools.workflows === "all" ? null : new Set(config.workflowTools.workflows);
  const usedNames = new Set<string>();
  const specs: ToolSpec[] = [];
  for (const dir of dirs) {
    let catalog: Map<string, { value: { id: string; title: string; description?: string } }>;
    try {
      catalog = (await loadWorkflowCatalog(repoRoot, dir)) as unknown as Map<string, { value: { id: string; title: string; description?: string } }>;
    } catch {
      continue;
    }
    for (const entry of catalog.values()) {
      if (allow && !allow.has(entry.value.id)) continue;
      const base = `workflow_${entry.value.id}`;
      let name = base;
      if (usedNames.has(name)) name = `${base}__${path.basename(dir).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      const title = entry.value.title;
      const description = entry.value.description?.trim();
      specs.push({
        name,
        description:
          `Запустить workflow "${title}" (папка ${path.basename(dir)}) и вернуть идентификатор прогона.` +
          (description ? ` ${description}` : ""),
        schema: {
          input: z.string().min(1).describe("запрос прогона (поле request входов workflow)"),
          title: z.string().optional().describe("заголовок прогона; по умолчанию название workflow"),
        },
        handler: (args) =>
          actions.startWorkflow({
            workspace: dir,
            workflowId: entry.value.id,
            input: { request: args.input },
            title: args.title,
          }),
      });
      if (specs.length >= MAX_DYNAMIC_TOOLS) return specs;
    }
  }
  return specs;
}
