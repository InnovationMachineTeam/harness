import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { loadWorkflowCatalog } from "./catalog";
import { listRoadmapItems, saveRoadmapItem } from "./roadmap";
import { workflowSchema, type WorkflowDefinition, type WorkflowStep } from "./schema";
import type { WorkflowStore, WorkflowRunRecord } from "./storage";

/** Динамический сегмент пути: идентификаторы без разделителей и обхода вверх. */
function safeId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value.includes("..")) throw new Error("недопустимый идентификатор: " + value.slice(0, 60));
  return value;
}

/** Путь внутри корня: resolve + проверка границы + посегментная валидация. */
function insideRoot(root: string, ...segments: string[]): string {
  for (const segment of segments) safeId(segment);
  const resolved = path.resolve(root, ...segments);
  if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("путь вне корня workspace");
  return resolved;
}

/* ------------------------------- запись спринта ------------------------------- */

export const sprintSchema = z.object({
  apiVersion: z.literal("harness/v1"),
  kind: z.literal("Sprint"),
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["created", "running", "completed", "failed"]).default("created"),
  rows: z.array(z.object({
    itemId: z.string(),
    workflowId: z.string(),
    bucket: z.number().int().min(1),
    order: z.number().int().min(0),
  })),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
export type SprintRecord = z.infer<typeof sprintSchema>;

export function sprintDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agents", "sprints");
}

export async function loadSprints(workspaceRoot: string): Promise<SprintRecord[]> {
  const names = await readdir(sprintDir(workspaceRoot)).catch(() => [] as string[]);
  const result: SprintRecord[] = [];
  for (const name of names.filter((value) => value.endsWith(".yaml")).sort()) {
    try {
      result.push(sprintSchema.parse(YAML.parse(await readFile(insideRoot(sprintDir(workspaceRoot), name), "utf8"))));
    } catch {
      // Повреждённая запись спринта не ломает список.
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveSprintRecord(workspaceRoot: string, sprint: SprintRecord): Promise<void> {
  const dir = sprintDir(workspaceRoot);
  await mkdir(dir, { recursive: true });
  const file = insideRoot(dir, sprint.id + ".yaml");
  const tmp = file + ".tmp";
  await writeFile(tmp, YAML.stringify(sprint, { lineWidth: 0 }), "utf8");
  await rename(tmp, file);
}

/** Создаёт запись спринта и помечает задачи лейблом спринта (статус ready). */
export async function createSprint(workspaceRoot: string, input: { title: string; rows: Array<{ itemId: string; workflowId: string; bucket: number; order: number }> }): Promise<SprintRecord> {
  if (!input.rows.length) throw new Error("спринт без задач");
  const sprint: SprintRecord = {
    apiVersion: "harness/v1",
    kind: "Sprint",
    id: "sprint-" + Date.now().toString(36),
    title: input.title.trim() || "Спринт",
    status: "created",
    rows: input.rows,
    createdAt: new Date().toISOString(),
  };
  const items = await listRoadmapItems(workspaceRoot);
  for (const row of sprint.rows) {
    const item = items.find((candidate) => candidate.id === row.itemId);
    if (!item) throw new Error("задача не найдена: " + row.itemId);
    if (item.labels.some((label) => label.startsWith("sprint:"))) throw new Error("задача уже в спринте: " + row.itemId);
    await saveRoadmapItem(workspaceRoot, {
      ...item,
      status: "ready",
      labels: [...item.labels, "sprint:" + sprint.id],
      updatedAt: new Date().toISOString(),
    });
  }
  await saveSprintRecord(workspaceRoot, sprint);
  return sprint;
}

async function updateSprint(workspaceRoot: string, sprintId: string, patch: Partial<SprintRecord>): Promise<void> {
  const sprints = await loadSprints(workspaceRoot);
  const sprint = sprints.find((item) => item.id === sprintId);
  if (!sprint) return;
  await saveSprintRecord(workspaceRoot, { ...sprint, ...patch });
}

/** Статус задачи на доске; лейбл спринта сохраняется. */
async function setItemStatus(workspaceRoot: string, itemId: string, status: string): Promise<void> {
  const items = await listRoadmapItems(workspaceRoot);
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  await saveRoadmapItem(workspaceRoot, { ...item, status, updatedAt: new Date().toISOString() });
}

/* --------------------------- workflow спринта --------------------------- */

const SPRINT_BASE: Pick<WorkflowStep, "phase" | "description" | "dependsOn" | "roles" | "runtime" | "execution" | "inputs" | "outputs" | "timeoutMs" | "retry" | "resources"> = {
  phase: "sprint",
  description: "",
  dependsOn: [],
  roles: [],
  runtime: { candidates: ["codex", "claude"] },
  execution: { prompt: "", confirmPlan: false, producesTasks: false },
  inputs: [],
  outputs: [],
  timeoutMs: 86_400_000,
  retry: { maxAttempts: 1 },
  resources: { workspace: "read" },
};

/** Служебный граф спринта: worktrees → параллельные корзины → закрытие → ретроспектива. */
export function buildSprintWorkflow(sprint: SprintRecord): WorkflowDefinition {
  const buckets = [...new Set(sprint.rows.map((row) => row.bucket))].sort((a, b) => a - b);
  const steps: WorkflowStep[] = [
    { ...SPRINT_BASE, id: "worktrees", title: "Подготовка worktrees", kind: "sprint-worktrees", hidden: true, outputs: ["worktrees"], timeoutMs: 3_600_000 },
    ...buckets.map((bucket) => ({ ...SPRINT_BASE, id: "bucket-" + bucket, title: "Корзина " + bucket, kind: "sprint-bucket", bucket, dependsOn: ["worktrees"], outputs: ["sprint-tasks"] })),
    { ...SPRINT_BASE, id: "close", title: "Закрытие спринта", kind: "sprint-close", hidden: true, dependsOn: buckets.map((bucket) => "bucket-" + bucket), roles: ["release-manager"] },
    { ...SPRINT_BASE, id: "lessons", title: "Ретроспектива и lessons learned", kind: "sprint-retrospective", hidden: true, dependsOn: ["close"], roles: ["knowledge-curator"] },
  ];
  return workflowSchema.parse({
    apiVersion: "harness/v1",
    kind: "Workflow",
    id: "sprint:" + sprint.id,
    title: "Спринт: " + sprint.title,
    description: "Автоматически собранный граф спринта; задачи выполняются по корзинам и порядку.",
    inputs: {},
    nodes: steps,
  });
}

/** Список задач из финального ```json-блока planning (producesTasks). */
export function parseTaskList(output: string): Array<{ title: string; description: string; value?: number; effort?: number }> {
  const blocks = output.match(/```json\s*([\s\S]*?)```/g) ?? [];
  for (const block of [...blocks].reverse()) {
    try {
      const parsed = JSON.parse(block.replace(/^```json\s*/, "").replace(/```\s*$/, "")) as unknown;
      if (!Array.isArray(parsed)) continue;
      return parsed
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && item.title))
        .map((item) => ({
          title: String(item.title),
          description: String(item.description ?? ""),
          value: typeof item.value === "number" ? item.value : undefined,
          effort: typeof item.effort === "number" ? item.effort : undefined,
        }));
    } catch { /* не список задач */ }
  }
  return [];
}

/* ------------------------------ служебные шаги ------------------------------ */

interface SprintTaskState {
  itemId: string;
  taskRunId: string;
  worktree: string;
  status: string;
}

export interface SprintNodeCtx {
  repoRoot: string;
  workspaceDir: string;
  store: WorkflowStore;
  run: WorkflowRunRecord;
  state: { artifacts: Record<string, string> };
  executeWorkflowCommand: (repoRoot: string, store: WorkflowStore, runId: string, command: { type: string; payload: Record<string, unknown> }) => Promise<void>;
}

interface SprintInput {
  id: string;
  title: string;
  rows: Array<{ itemId: string; workflowId: string; bucket: number; order: number }>;
}

function sprintInput(run: WorkflowRunRecord): SprintInput {
  const sprint = run.input.sprint as SprintInput | undefined;
  if (!sprint || !Array.isArray(sprint.rows)) throw new Error("прогон спринта без sprint-входа");
  return { id: safeId(sprint.id), title: String(sprint.title ?? ""), rows: sprint.rows };
}

function collectSprintTaskState(state: SprintNodeCtx["state"]): Record<string, SprintTaskState> {
  const raw = state.artifacts["sprint-tasks"];
  return raw ? JSON.parse(raw) as Record<string, SprintTaskState> : {};
}

async function runWorktrees(ctx: SprintNodeCtx, sprint: SprintInput) {
  const map: Record<string, string> = {};
  const base = insideRoot(ctx.workspaceDir, ".agents", ".worktrees");
  const ordered = [...sprint.rows].sort((a, b) => a.bucket - b.bucket || a.order - b.order);
  const seen = new Set<string>();
  let index = 0;
  for (const row of ordered) {
    if (seen.has(row.itemId)) continue;
    seen.add(row.itemId);
    index += 1;
    const worktree = insideRoot(base, sprint.id + "-" + index);
    const branch = safeId("sprint-" + sprint.id + "-" + index);
    const result = spawnSync("git", ["worktree", "add", worktree, "-b", branch], { cwd: ctx.workspaceDir, encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0 && !/already exists|already registered/.test(String(result.stderr ?? ""))) {
      throw new Error("worktree не создан: " + (String(result.stderr || result.stdout || "").trim().slice(0, 300)));
    }
    map[row.itemId] = worktree;
    ctx.store.appendEvent(ctx.run.id, "sprint.worktree-ready", { itemId: row.itemId, worktree }, { stepId: "worktrees" });
  }
  const payload = JSON.stringify(map);
  ctx.store.saveArtifact(ctx.run.id, "worktrees", "worktrees", payload);
  return { artifacts: { worktrees: payload }, completed: ["worktrees"] };
}

async function runBucket(ctx: SprintNodeCtx, node: WorkflowStep, sprint: SprintInput) {
  const worktreeMapRaw = ctx.state.artifacts["worktrees"];
  const worktreeMap: Record<string, string> = worktreeMapRaw ? JSON.parse(worktreeMapRaw) : {};
  const rows = sprint.rows.filter((row) => row.bucket === node.bucket).sort((a, b) => a.order - b.order);
  const items = await listRoadmapItems(ctx.workspaceDir);
  const catalog = await loadWorkflowCatalog(ctx.repoRoot, ctx.workspaceDir);
  const results: Record<string, SprintTaskState> = collectSprintTaskState(ctx.state);
  for (const row of rows) {
    const item = items.find((candidate) => candidate.id === row.itemId);
    if (!item) throw new Error("задача спринта не найдена: " + row.itemId);
    const entry = catalog.get(row.workflowId);
    if (!entry) throw new Error("workflow задачи не найден: " + row.workflowId);
    const worktree = worktreeMap[row.itemId] ?? insideRoot(insideRoot(ctx.workspaceDir, ".agents", ".worktrees"), sprint.id + "-" + row.itemId);
    await setItemStatus(ctx.workspaceDir, row.itemId, "in-progress");
    const taskRun = ctx.store.createRun({
      workspaceDir: ctx.workspaceDir,
      workflow: entry.value,
      title: item.title,
      values: { request: item.description || item.title, worktree },
      roadmapItemId: row.itemId,
    });
    ctx.store.appendEvent(ctx.run.id, "sprint.task-started", { itemId: row.itemId, taskRunId: taskRun.id, workflowId: row.workflowId, worktree }, { stepId: node.id });
    await ctx.executeWorkflowCommand(ctx.repoRoot, ctx.store, taskRun.id, { type: "start", payload: {} });
    const status = ctx.store.getRun(taskRun.id)?.status ?? "interrupted";
    const boardStatus = status === "completed" ? "done" : status === "waiting" ? "review" : "blocked";
    await setItemStatus(ctx.workspaceDir, row.itemId, boardStatus);
    ctx.store.appendEvent(ctx.run.id, "sprint.task-finished", { itemId: row.itemId, taskRunId: taskRun.id, status, boardStatus }, { stepId: node.id });
    results[safeId(row.itemId)] = { itemId: row.itemId, taskRunId: taskRun.id, worktree, status };
  }
  const payload = JSON.stringify(results);
  ctx.store.saveArtifact(ctx.run.id, node.id, "sprint-tasks", payload);
  return { artifacts: { "sprint-tasks": payload }, completed: [node.id] };
}

async function runClose(ctx: SprintNodeCtx, sprint: SprintInput) {
  const results = collectSprintTaskState(ctx.state);
  const failed = Object.values(results).filter((task) => task.status !== "completed").length;
  await updateSprint(ctx.workspaceDir, sprint.id, { status: failed ? "failed" : "completed", finishedAt: new Date().toISOString() });
  ctx.store.appendEvent(ctx.run.id, "sprint.completed", { total: Object.keys(results).length, failed }, { stepId: "close" });
  return { artifacts: {}, completed: ["close"] };
}

async function runRetrospective(ctx: SprintNodeCtx, node: WorkflowStep, sprint: SprintInput) {
  const results = collectSprintTaskState(ctx.state);
  const tasksRoot = insideRoot(ctx.workspaceDir, ".agents", "tasks");
  const notes: string[] = [];
  for (const task of Object.values(results)) {
    const taskDir = insideRoot(tasksRoot, task.taskRunId);
    for (const kind of ["errors", "returns"]) {
      const dir = insideRoot(taskDir, kind);
      const entries = await readdir(dir).catch(() => [] as string[]);
      for (const name of entries.sort()) {
        const content = await readFile(insideRoot(dir, name), "utf8").catch(() => "");
        if (content.trim()) notes.push("### " + task.itemId + "/" + kind + "/" + name + "\n" + content.slice(0, 4000));
      }
    }
  }
  const { resolveRoles, runAgentCall, parseLessonsProposals } = await import("./engine");
  const effectiveRoles = node.roles.length ? node.roles : ["knowledge-curator"];
  const roles = await resolveRoles(ctx.repoRoot, ctx.run, effectiveRoles);
  const assignment = [
    "Проведи ретроспективу спринта \"" + sprint.title + "\": обход ошибок и возвратов задач, предложения по обновлению ролей и навыков.",
    notes.length ? notes.join("\n\n") : "Ошибок и возвратов нет; предложи не более одного улучшения профилактического характера или верни пустой список [].",
    "",
    "Формат ответа: последний блок ```json со списком предложений:",
    '[{"target":".agents/roles/<папка>/<роль>.md или id навыка","kind":"role|skill|manual","title":"...","diff":"...","reason":"...","category":"auto|manual"}]',
  ].join("\n");
  const result = await runAgentCall({
    repoRoot: ctx.repoRoot, store: ctx.store, run: ctx.run,
    node: { ...node, roles: effectiveRoles },
    state: ctx.state as never, section: "ретроспектива", roles, assignment, verdictRequired: false, lockWorkspace: false,
  });
  const proposals = parseLessonsProposals(result.output);
  const dir = sprintDir(ctx.workspaceDir);
  await mkdir(dir, { recursive: true });
  const file = insideRoot(dir, sprint.id + "-retrospective.md");
  await writeFile(file, "# Ретроспектива: " + sprint.title + "\n\n```json\n" + JSON.stringify(proposals, null, 2) + "\n```\n", "utf8");
  ctx.store.saveArtifact(ctx.run.id, "lessons", "__lessons-proposals", JSON.stringify(proposals), path.relative(ctx.workspaceDir, file));
  ctx.store.appendEvent(ctx.run.id, "sprint.retrospective", { total: proposals.length }, { stepId: "lessons" });
  return { artifacts: {}, completed: ["lessons"] };
}

export async function runSprintNode(node: WorkflowStep, ctx: SprintNodeCtx): Promise<{ artifacts: Record<string, string>; completed: string[] }> {
  const sprint = sprintInput(ctx.run);
  if (node.kind === "sprint-worktrees") return runWorktrees(ctx, sprint);
  if (node.kind === "sprint-bucket") return runBucket(ctx, node, sprint);
  if (node.kind === "sprint-close") return runClose(ctx, sprint);
  if (node.kind === "sprint-retrospective") return runRetrospective(ctx, node, sprint);
  throw new Error("неизвестный служебный шаг спринта: " + node.kind);
}
