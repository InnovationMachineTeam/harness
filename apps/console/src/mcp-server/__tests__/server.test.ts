import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { HarnessMcpActions } from "@/mcp-server/actions";
import { defaultHarnessMcpConfig } from "@/mcp-server/config";
import { buildHarnessMcpServer } from "@/mcp-server/server";

/**
 * Интеграция сервера через связку InMemoryTransport: клиент SDK подключается
 * к серверу harness, получает набор по конфигу и вызывает инструменты.
 */

let root = "";
let harness: Awaited<ReturnType<typeof buildHarnessMcpServer>> | null = null;
let client: Client | null = null;

/** Действия-заглушки: список папок фиксирован, остальное - пустые ответы. */
function fakeActions(): HarnessMcpActions {
  return {
    runPrompt: async () => ({ ok: true, runtime: "claude", logFile: "/tmp/run.log", pid: 123, detail: "запущен" }),
    listWorkflows: async () => [{ id: "sdlc", title: "SDLC", steps: [] }],
    readWorkflow: async () => ({ id: "sdlc", title: "SDLC", yaml: "apiVersion: harness/v1" }),
    startWorkflow: async () => ({ run: { id: "run-1", status: "queued" } }),
    workflowStatus: async () => ({ run: { id: "run-1", status: "running" }, lastEvents: [] }),
    workflowEvents: async () => ({ runId: "run-1", status: "running", events: [] }),
    workflowAction: async () => ({ ok: true }),
    listRoutines: async () => ({ routines: [], runs: [] }),
    createRoutine: async () => ({ routine: { id: "r-1" } }),
    updateRoutine: async () => ({ routine: { id: "r-1" } }),
    deleteRoutine: async () => ({ ok: true }),
    runRoutineNow: async () => ({ queued: true }),
    listWorkspaces: async () => [{ dir: "/tmp/ws", mode: "write", exposed: true }],
    listRoles: async () => [{ id: "reviewer", title: "Рецензент" }],
    listSkills: async () => [{ id: "code-review", title: "Ревью кода" }],
    slashMenu: async () => ({ workflows: [], agents: [] }),
    listSessions: async () => [{ id: "s-1", runtime: "claude" }],
    searchSessions: async () => ({ hits: [] }),
    replySession: async () => ({ ok: true }),
    listTasks: async () => ({ tasks: [] }),
    listProcesses: async () => ({ processes: [] }),
    stopProcess: async () => ({ ok: true }),
    listLessons: async () => ({ lessons: [] }),
    listRoadmap: async () => ({ items: [] }),
    listSprints: async () => ({ sprints: [] }),
    stats: async () => ({ totals: {} }),
    readFile: async () => ({ name: "doc.md", content: "# Документ" }),
  } satisfies HarnessMcpActions;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-mcp-server-"));
  const config = defaultHarnessMcpConfig();
  config.groups.monitoring = true;
  config.monitoring.stopProcesses = true;
  config.workflowTools.enabled = false;
  harness = await buildHarnessMcpServer({ repoRoot: root, config, actions: fakeActions() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await harness.server.connect(serverTransport);
  client = new Client({ name: "harness-mcp-test", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  harness?.stop();
  await client?.close().catch(() => undefined);
  if (root) await rm(root, { recursive: true, force: true });
});

describe("MCP-сервер harness по InMemoryTransport", () => {
  test("tools/list отдаёт инструменты включённых групп с описаниями", async () => {
    const result = await client!.listTools();
    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain("run_prompt");
    expect(names).toContain("start_workflow");
    expect(names).toContain("list_roles");
    expect(names).toContain("stop_process");
    expect(names).not.toContain("workflow_alpha-flow");
    const runPrompt = result.tools.find((tool) => tool.name === "run_prompt")!;
    expect(runToolProperty(runPrompt, "prompt")).toBeTruthy();
  });

  test("вызов инструмента возвращает текст (JSON) с данными действия", async () => {
    const result = await client!.callTool({ name: "list_workspaces", arguments: {} });
    const text = toolText(result);
    expect(JSON.parse(text)).toEqual([{ dir: "/tmp/ws", mode: "write", exposed: true }]);
  });

  test("исключение действия превращается в isError с текстом ошибки", async () => {
    const failing = await buildHarnessMcpServer({
      repoRoot: root,
      config: { ...defaultHarnessMcpConfig(), workflowTools: { enabled: false, workflows: "all" } },
      actions: new Proxy(fakeActions(), {
        get(target, prop: string) {
          return prop === "listRoles" ? async () => { throw new Error("каталог недоступен"); } : (target as unknown as Record<string, unknown>)[prop];
        },
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await failing.server.connect(serverTransport);
    const failingClient = new Client({ name: "harness-mcp-test", version: "1.0.0" });
    await failingClient.connect(clientTransport);
    try {
      const result = await failingClient.callTool({ name: "list_roles", arguments: {} });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(toolText(result)).toContain("каталог недоступен");
    } finally {
      failing.stop();
      await failingClient.close().catch(() => undefined);
    }
  });
});

/** Свойство схемы инструмента по имени параметра. */
function runToolProperty(tool: { inputSchema?: { properties?: Record<string, unknown> } }, key: string): unknown {
  return tool.inputSchema?.properties?.[key];
}

/** Текст первого текстового блока результата. */
function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return content.find((block) => block.type === "text")?.text ?? "";
}
