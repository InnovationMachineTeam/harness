import path from "node:path";
import { findRepoRoot } from "@/core/repo";
import { loadConsoleState, workspaceDirs, type ConsoleState } from "@/core/state";
import { loadInternalSkills, loadRoles, loadWorkflowCatalog } from "@/core/workflows/catalog";
import { WorkflowStore } from "@/core/workflows/storage";
import { exposedWorkspaces, loadHarnessMcpConfig, type HarnessMcpConfig } from "./config";
import * as promptsRunRoute from "@/app/api/prompts/run/route";
import * as workflowRunsRoute from "@/app/api/workflow-runs/route";
import * as workflowRunActionsRoute from "@/app/api/workflow-runs/[id]/actions/route";
import * as routinesRoute from "@/app/api/routines/route";
import * as routineRoute from "@/app/api/routines/[id]/route";
import * as sessionsRoute from "@/app/api/sessions/route";
import * as sessionsSearchRoute from "@/app/api/sessions/search/route";
import * as sessionsReplyRoute from "@/app/api/sessions/reply/route";
import * as slashMenuRoute from "@/app/api/slash-menu/route";
import * as monitoringTasksRoute from "@/app/api/monitoring/tasks/route";
import * as monitoringProcessesRoute from "@/app/api/monitoring/processes/route";
import * as monitoringProcessesActionRoute from "@/app/api/monitoring/processes/action/route";
import * as lessonsRoute from "@/app/api/lessons/route";
import * as roadmapRoute from "@/app/api/roadmap/route";
import * as sprintsRoute from "@/app/api/sprints/route";
import * as statsRoute from "@/app/api/stats/route";
import * as memoryFileRoute from "@/app/api/memory/file/route";

/**
 * Слой действий MCP-сервера harness. Мутирующие и сложные операции вызывают
 * route handlers консоли in-process: логика запуска (preflight, snapshot,
 * планировщик) живёт в одном месте, MCP-сервер не дублирует её. Чтения каталогов
 * и события прогона идут напрямую в core (роуты чтения либо тяжелее - весь
 * snapshot прогона, либо являются SSE-стримом).
 */

/** Контекст динамических роутов Next.js (params) различается по форме - здесь он не типизируется. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (request: Request, context?: any) => Promise<Response>;

/** Вызов route handler с JSON-телом/запросом; ответ разворачивается, HTTP-ошибка - исключение. */
async function callRoute(handler: RouteHandler, query: string, init?: RequestInit, routeParams?: Record<string, string>): Promise<Record<string, unknown>> {
  const request = new Request("http://harness.local" + query, init);
  const response = routeParams
    ? await handler(request, { params: Promise.resolve(routeParams) })
    : await handler(request);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `запрос не выполнен (HTTP ${response.status})`);
  }
  return body;
}

function post(body: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: Record<string, unknown>): RequestInit {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function del(): RequestInit {
  return { method: "DELETE" };
}

/** Контекст вызова инструмента: корень репо, состояние, конфиг сервера, экспонируемые папки. */
export interface ToolCallContext {
  repoRoot: string;
  state: ConsoleState;
  config: HarnessMcpConfig;
  /** Экспонируемые конфигом рабочие папки (пересечение со state.workspaces). */
  workspaces: string[];
  /** Резолв папки запроса: обязательный член экспонируемого списка (default - первая папка). */
  workspace(requested?: string): string;
}

export async function toolCallContext(repoRoot = findRepoRoot()): Promise<ToolCallContext> {
  const state = await loadConsoleState(repoRoot);
  const config = await loadHarnessMcpConfig(repoRoot);
  const workspaces = exposedWorkspaces(config, workspaceDirs(state));
  return {
    repoRoot,
    state,
    config,
    workspaces,
    workspace(requested?: string): string {
      const candidate = requested?.trim() || workspaces[0];
      if (!candidate) throw new Error("рабочие папки не настроены");
      const resolved = path.resolve(candidate);
      const found = workspaces.find((dir) => path.resolve(dir) === resolved);
      if (!found) throw new Error(`папка не входит в экспонируемые рабочие папки MCP-сервера: ${resolved}`);
      return found;
    },
  };
}

export interface HarnessMcpActions {
  /* prompts */
  runPrompt(args: { prompt: string; runtime?: string; workspace?: string }): Promise<Record<string, unknown>>;
  /* workflows */
  listWorkflows(args: { workspace?: string }): Promise<Record<string, unknown>[]>;
  readWorkflow(args: { workspace?: string; workflowId: string }): Promise<Record<string, unknown>>;
  startWorkflow(args: {
    workspace?: string;
    workflowId?: string;
    title?: string;
    targetNodes?: string[];
    startNodeId?: string;
    endNodeId?: string;
    input?: Record<string, unknown>;
    roadmapItemId?: string;
    forkFromRunId?: string;
  }): Promise<Record<string, unknown>>;
  workflowStatus(args: { workspace?: string; runId: string }): Promise<Record<string, unknown>>;
  workflowEvents(args: { workspace?: string; runId: string; after?: number; limit?: number }): Promise<Record<string, unknown>>;
  workflowAction(args: { workspace?: string; runId: string; action: string; payload?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  /* routines */
  listRoutines(args: { workspace?: string }): Promise<Record<string, unknown>>;
  createRoutine(args: {
    workspace?: string;
    title: string;
    prompt: string;
    executor?: string;
    intervalMin?: number;
    scheduleType?: "interval" | "cron";
    cronExpr?: string;
    enabled?: boolean;
  }): Promise<Record<string, unknown>>;
  updateRoutine(args: {
    workspace?: string;
    id: string;
    title?: string;
    prompt?: string;
    executor?: string;
    intervalMin?: number;
    scheduleType?: "interval" | "cron";
    cronExpr?: string;
    enabled?: boolean;
  }): Promise<Record<string, unknown>>;
  deleteRoutine(args: { workspace?: string; id: string }): Promise<Record<string, unknown>>;
  runRoutineNow(args: { workspace?: string; id: string }): Promise<Record<string, unknown>>;
  /* catalog */
  listWorkspaces(): Promise<Record<string, unknown>[]>;
  listRoles(args: { filter?: string }): Promise<Record<string, unknown>[]>;
  listSkills(): Promise<Record<string, unknown>[]>;
  slashMenu(args: { workspace?: string; executor: string; workflowId?: string }): Promise<Record<string, unknown>>;
  /* sessions */
  listSessions(args: { runtime?: string; dir?: string; limit?: number }): Promise<Record<string, unknown>[]>;
  searchSessions(args: { query: string; runtime?: string; dir?: string; limit?: number }): Promise<Record<string, unknown>>;
  replySession(args: { runtime: string; sessionId: string; text: string }): Promise<Record<string, unknown>>;
  /* monitoring */
  listTasks(): Promise<Record<string, unknown>>;
  listProcesses(): Promise<Record<string, unknown>>;
  stopProcess(args: { pid: number }): Promise<Record<string, unknown>>;
  /* knowledge */
  listLessons(): Promise<Record<string, unknown>>;
  listRoadmap(args: { workspace?: string }): Promise<Record<string, unknown>>;
  listSprints(): Promise<Record<string, unknown>>;
  stats(args: { days?: number }): Promise<Record<string, unknown>>;
  readFile(args: { path: string }): Promise<Record<string, unknown>>;
}

/** Действия над реальным репозиторием harness (HARNESS_ROOT / walk-up от cwd). */
export function createHarnessActions(): HarnessMcpActions {
  return {
    async runPrompt(args) {
      const ctx = await toolCallContext();
      return callRoute(promptsRunRoute.POST, "/api/prompts/run", post({
        prompt: args.prompt,
        ...(args.runtime ? { runtime: args.runtime } : {}),
        ...(args.workspace ? { workspace: ctx.workspace(args.workspace) } : {}),
      }));
    },

    async listWorkflows(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      const catalog = await loadWorkflowCatalog(ctx.repoRoot, workspace);
      return [...catalog.values()].map((entry) => ({
        id: entry.value.id,
        title: entry.value.title,
        description: entry.value.description ?? "",
        extends: entry.value.extends ?? null,
        scope: entry.scope,
        steps: entry.value.nodes.map((node) => ({ id: node.id, title: node.title, phase: node.phase })),
      }));
    },

    async readWorkflow(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      const catalog = await loadWorkflowCatalog(ctx.repoRoot, workspace);
      const entry = catalog.get(args.workflowId);
      if (!entry) throw new Error(`workflow не найден: ${args.workflowId}`);
      const yaml = entry.yaml.length > 24_000 ? entry.yaml.slice(0, 24_000) + "\n# ...(отсечено)" : entry.yaml;
      return { id: entry.value.id, title: entry.value.title, workspace, yaml };
    },

    async startWorkflow(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(workflowRunsRoute.POST, "/api/workflow-runs", post({
        workspace,
        workflowId: args.workflowId,
        title: args.title,
        targetNodes: args.targetNodes,
        startNodeId: args.startNodeId,
        endNodeId: args.endNodeId,
        input: args.input,
        roadmapItemId: args.roadmapItemId,
        forkFromRunId: args.forkFromRunId,
      }));
    },

    async workflowStatus(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      const store = new WorkflowStore(ctx.repoRoot, workspace);
      try {
        const run = store.getRun(args.runId);
        if (!run) throw new Error(`run не найден: ${args.runId}`);
        const { snapshot, ...record } = run;
        const events = store.listEvents(args.runId, 0, 10);
        return {
          run: { ...record, workflowTitle: snapshot.title, nodeCount: snapshot.nodes.length },
          lastEvents: events.map((event) => ({ at: event.at, type: event.type, stepId: event.stepId })),
        };
      } finally {
        store.close();
      }
    },

    async workflowEvents(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      const store = new WorkflowStore(ctx.repoRoot, workspace);
      try {
        const run = store.getRun(args.runId);
        if (!run) throw new Error(`run не найден: ${args.runId}`);
        const after = typeof args.after === "number" && args.after >= 0 ? Math.floor(args.after) : 0;
        const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(Math.floor(args.limit), 200) : 50;
        const events = store.listEvents(args.runId, after, limit);
        return {
          runId: args.runId,
          status: run.status,
          events: events.map((event) => ({
            id: event.id,
            at: event.at,
            type: event.type,
            stepId: event.stepId,
            payload: event.payload,
          })),
        };
      } finally {
        store.close();
      }
    },

    async workflowAction(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(
        workflowRunActionsRoute.POST,
        `/api/workflow-runs/${encodeURIComponent(args.runId)}/actions`,
        post({ workspace, action: args.action, payload: args.payload }),
        { id: args.runId },
      );
    },

    async listRoutines(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      const query = `?workspace=${encodeURIComponent(workspace)}`;
      return callRoute(routinesRoute.GET, "/api/routines" + query);
    },

    async createRoutine(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(routinesRoute.POST, "/api/routines", post({
        workspace,
        title: args.title,
        prompt: args.prompt,
        executor: args.executor,
        intervalMin: args.intervalMin,
        scheduleType: args.scheduleType,
        cronExpr: args.cronExpr,
        enabled: args.enabled,
      }));
    },

    async updateRoutine(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(
        routineRoute.PATCH,
        `/api/routines/${encodeURIComponent(args.id)}`,
        patch({
          workspace,
          title: args.title,
          prompt: args.prompt,
          executor: args.executor,
          intervalMin: args.intervalMin,
          scheduleType: args.scheduleType,
          cronExpr: args.cronExpr,
          enabled: args.enabled,
        }),
        { id: args.id },
      );
    },

    async deleteRoutine(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(
        routineRoute.DELETE,
        `/api/routines/${encodeURIComponent(args.id)}?workspace=${encodeURIComponent(workspace)}`,
        del(),
        { id: args.id },
      );
    },

    async runRoutineNow(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(
        routineRoute.POST,
        `/api/routines/${encodeURIComponent(args.id)}`,
        post({ workspace }),
        { id: args.id },
      );
    },

    async listWorkspaces() {
      const ctx = await toolCallContext();
      const exposed = new Set(ctx.workspaces.map((dir) => path.resolve(dir)));
      return workspaceDirs(ctx.state).map((dir) => ({
        dir,
        mode: dir === ctx.state.workspaces.mandatory ? "write" : "read",
        exposed: exposed.has(path.resolve(dir)),
      }));
    },

    async listRoles(args) {
      const ctx = await toolCallContext();
      const roles = await loadRoles(ctx.repoRoot);
      const filter = args.filter?.trim().toLowerCase() ?? "";
      return roles
        .map((role) => ({
          id: role.value.id,
          title: role.value.title,
          folder: role.folder,
          domain: role.value.domain ?? null,
          skills: role.value.skills,
          subagent: role.value.subagent ?? false,
        }))
        .filter((role) => !filter || role.id.toLowerCase().includes(filter) || role.title.toLowerCase().includes(filter));
    },

    async listSkills() {
      const ctx = await toolCallContext();
      const internal = await loadInternalSkills(ctx.repoRoot);
      return internal.map((skill) => ({
        id: skill.value.id,
        title: skill.value.title,
        group: skill.group,
        description: skill.value.description,
        tags: skill.value.tags,
      }));
    },

    async slashMenu(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      const query = new URLSearchParams({ executor: args.executor, workflowId: args.workflowId ?? "direct", workspace });
      return callRoute(slashMenuRoute.GET, "/api/slash-menu?" + query.toString());
    },

    async listSessions(args) {
      const query = new URLSearchParams();
      if (args.runtime) query.set("runtime", args.runtime);
      if (args.dir) query.set("dir", args.dir);
      const body = await callRoute(sessionsRoute.GET, "/api/sessions" + (query.size ? "?" + query.toString() : ""));
      const sessions = Array.isArray(body.sessions) ? body.sessions : [];
      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 100) : 30;
      return sessions.slice(0, limit);
    },

    async searchSessions(args) {
      const query = new URLSearchParams({ q: args.query });
      if (args.runtime) query.set("runtime", args.runtime);
      if (args.dir) query.set("dir", args.dir);
      if (typeof args.limit === "number" && args.limit > 0) query.set("limit", String(Math.min(args.limit, 100)));
      return callRoute(sessionsSearchRoute.GET, "/api/sessions/search?" + query.toString());
    },

    async replySession(args) {
      return callRoute(sessionsReplyRoute.POST, "/api/sessions/reply", post({
        runtime: args.runtime,
        sessionId: args.sessionId,
        text: args.text,
      }));
    },

    async listTasks() {
      return callRoute(monitoringTasksRoute.GET, "/api/monitoring/tasks");
    },

    async listProcesses() {
      return callRoute(monitoringProcessesRoute.GET, "/api/monitoring/processes");
    },

    async stopProcess(args) {
      return callRoute(monitoringProcessesActionRoute.POST, "/api/monitoring/processes/action", post({ pid: args.pid, action: "stop" }));
    },

    async listLessons() {
      return callRoute(lessonsRoute.GET, "/api/lessons");
    },

    async listRoadmap(args) {
      const ctx = await toolCallContext();
      const workspace = ctx.workspace(args.workspace);
      return callRoute(roadmapRoute.GET, "/api/roadmap?workspace=" + encodeURIComponent(workspace));
    },

    async listSprints() {
      return callRoute(sprintsRoute.GET, "/api/sprints");
    },

    async stats(args) {
      const query = new URLSearchParams();
      if (typeof args.days === "number" && args.days > 0) query.set("days", String(Math.min(Math.floor(args.days), 90)));
      return callRoute(statsRoute.GET, "/api/stats" + (query.size ? "?" + query.toString() : ""));
    },

    async readFile(args) {
      return callRoute(memoryFileRoute.GET, "/api/memory/file?path=" + encodeURIComponent(args.path));
    },
  };
}
