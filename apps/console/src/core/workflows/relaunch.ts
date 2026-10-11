import { loadWorkflowCatalog } from "./catalog";
import { WorkflowStore, type WorkflowRunRecord } from "./storage";

/** Статусы исходного прогона, из которых доступен перезапуск актуальной версией workflow. */
export const RELAUNCHABLE_STATUSES = ["failed", "interrupted", "cancelled", "completed"];

/**
 * Новый прогон из актуальной версии workflow каталога: входы, заголовок,
 * целевые шаги и задача roadmap переносятся из исходного прогона, снапшот
 * исходного прогона не используется. Применяется после исправления workflow:
 * retry и restart продолжают замороженный снапшот, relaunch начинается заново
 * на текущей версии определения.
 */
export async function relaunchRunFromCatalog(opts: {
  repoRoot: string;
  store: WorkflowStore;
  source: WorkflowRunRecord;
  reason: string;
}): Promise<WorkflowRunRecord> {
  if (!RELAUNCHABLE_STATUSES.includes(opts.source.status)) throw new Error("перезапуск доступен из терминального статуса, текущий: " + opts.source.status);
  if (opts.source.workflowId.startsWith("sprint:")) throw new Error("прогон спринта не перезапускается как задача");
  const catalog = await loadWorkflowCatalog(opts.repoRoot, opts.source.workspaceDir);
  const workflow = catalog.get(opts.source.workflowId)?.value;
  if (!workflow) throw new Error("workflow не найден в каталоге: " + opts.source.workflowId);
  const run = opts.store.createRun({
    workspaceDir: opts.source.workspaceDir,
    workflow,
    title: opts.source.title,
    targetNodes: opts.source.targetNodes,
    values: opts.source.input,
    roadmapItemId: opts.source.roadmapItemId ?? null,
  });
  opts.store.appendEvent(run.id, "run.relaunched", { sourceRunId: opts.source.id, workflowId: opts.source.workflowId, reason: opts.reason });
  opts.store.appendEvent(opts.source.id, "run.action", { action: "relaunch-current", newRunId: run.id, reason: opts.reason });
  return run;
}
