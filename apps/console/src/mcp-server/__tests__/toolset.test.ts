import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HarnessMcpActions } from "@/mcp-server/actions";
import { defaultHarnessMcpConfig } from "@/mcp-server/config";
import { collectHarnessToolSpecs } from "@/mcp-server/server";
import { buildDynamicWorkflowTools, MAX_DYNAMIC_TOOLS } from "@/mcp-server/tools/dynamic";

/** Заглушка действий: ни один вызов не касается реального репозитория. */
function fakeActions(log: Array<{ action: string; args: unknown }> = []): HarnessMcpActions {
  const record = (action: string) => (args: unknown) => {
    log.push({ action, args });
    return Promise.resolve({ ok: true, action });
  };
  return new Proxy({} as HarnessMcpActions, {
    get(_target, prop: string) {
      return record(prop);
    },
  });
}

let root = "";
let secondWorkspace = "";

const WORKFLOW_YAML = (id: string, title: string) => [
  "apiVersion: harness/v1",
  "kind: Workflow",
  `id: ${id}`,
  `title: ${title}`,
  "description: Workflow фикстуры",
  "nodes:",
  "  - id: only",
  "    title: Единственный шаг",
  "    phase: build",
  "    roles: []",
  "    runtime:",
  "      candidates: []",
  "    execution:",
  "      prompt: Работа",
  "",
].join("\n");

async function writeWorkspace(dir: string, workflows: Array<[string, string]>): Promise<void> {
  await mkdir(path.join(dir, ".agents", "skills", "master", "workflows"), { recursive: true });
  for (const [id, title] of workflows) {
    await writeFile(path.join(dir, ".agents", "skills", "master", "workflows", `${id}.yaml`), WORKFLOW_YAML(id, title), "utf8");
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-mcp-tools-"));
  secondWorkspace = await mkdtemp(path.join(tmpdir(), "harness-mcp-tools-ws2-"));
  await writeWorkspace(root, [["alpha-flow", "Alpha Flow"], ["beta-flow", "Beta Flow"]]);
  await writeWorkspace(secondWorkspace, [["alpha-flow", "Alpha Flow второй папки"]]);
  // состояние: обязательная папка root + дополнительная secondWorkspace
  await mkdir(path.join(root, ".agents", "console"), { recursive: true });
  await writeFile(
    path.join(root, ".agents", "console", "state.json"),
    JSON.stringify({ workspaces: { mandatory: root, additional: [secondWorkspace], openwiki: [], graphify: [], docs: [] } }),
    "utf8",
  );
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  if (secondWorkspace) await rm(secondWorkspace, { recursive: true, force: true });
});

describe("набор инструментов по конфигу", () => {
  test("все группы дают ожидаемые имена; monitoring выключен по умолчанию", async () => {
    const specs = await collectHarnessToolSpecs(defaultHarnessMcpConfig(), fakeActions(), root);
    const names = specs.map((spec) => spec.name);
    expect(names).toContain("run_prompt");
    expect(names).toContain("start_workflow");
    expect(names).toContain("workflow_action");
    expect(names).toContain("create_routine");
    expect(names).toContain("list_roles");
    expect(names).toContain("list_sessions");
    expect(names).toContain("read_file");
    expect(names).not.toContain("list_tasks");
    expect(names).not.toContain("stop_process");
  });

  test("monitoring включён: stop_process скрыт без флага и появляется с флагом", async () => {
    const config = defaultHarnessMcpConfig();
    config.groups.monitoring = true;
    const withoutFlag = (await collectHarnessToolSpecs(config, fakeActions(), root)).map((spec) => spec.name);
    expect(withoutFlag).toContain("list_tasks");
    expect(withoutFlag).not.toContain("stop_process");

    config.monitoring.stopProcesses = true;
    const withFlag = (await collectHarnessToolSpecs(config, fakeActions(), root)).map((spec) => spec.name);
    expect(withFlag).toContain("stop_process");
  });

  test("выключенная группа исключает её инструменты", async () => {
    const config = defaultHarnessMcpConfig();
    config.groups.workflows = false;
    const names = (await collectHarnessToolSpecs(config, fakeActions(), root)).map((spec) => spec.name);
    expect(names).not.toContain("start_workflow");
    expect(names).toContain("run_prompt");
  });
});

describe("динамические workflow-инструменты", () => {
  test("workflow папок становятся инструментами; коллизия id разрешается суффиксом", async () => {
    const config = defaultHarnessMcpConfig();
    const specs = await buildDynamicWorkflowTools(config, fakeActions(), root);
    const names = specs.map((spec) => spec.name);
    expect(names).toContain("workflow_alpha-flow");
    expect(names).toContain("workflow_beta-flow");
    expect(names).toContain(`workflow_alpha-flow__${path.basename(secondWorkspace)}`);

    const alpha = specs.find((spec) => spec.name === "workflow_alpha-flow")!;
    expect(alpha.description).toContain("Alpha Flow");
  });

  test("вызов инструмента запускает workflow своей папки", async () => {
    const log: Array<{ action: string; args: unknown }> = [];
    const specs = await buildDynamicWorkflowTools(defaultHarnessMcpConfig(), fakeActions(log), root);
    const collided = specs.find((spec) => spec.name.startsWith("workflow_alpha-flow__"))!;
    await collided.handler({ input: "запрос", title: "Прогон" });
    const call = log.find((entry) => entry.action === "startWorkflow");
    expect(call?.args).toMatchObject({
      workspace: secondWorkspace,
      workflowId: "alpha-flow",
      input: { request: "запрос" },
      title: "Прогон",
    });
  });

  test("allowlist и потолок числа инструментов", async () => {
    const config = defaultHarnessMcpConfig();
    config.workflowTools.workflows = ["beta-flow"];
    const names = (await buildDynamicWorkflowTools(config, fakeActions(), root)).map((spec) => spec.name);
    // каталог второй папки содержит мастер-workflows корня + свои переопределения:
    // beta-flow есть в обеих папках, коллизия разрешается суффиксом
    expect(names).toEqual(["workflow_beta-flow", `workflow_beta-flow__${path.basename(secondWorkspace)}`]);

    config.workflowTools.workflows = "all";
    config.workflowTools.enabled = false;
    expect(await buildDynamicWorkflowTools(config, fakeActions(), root)).toEqual([]);
    expect(MAX_DYNAMIC_TOOLS).toBe(30);
  });

  test("неэкспонированная папка не даёт инструментов", async () => {
    const config = defaultHarnessMcpConfig();
    config.workspaces = [root];
    const names = (await buildDynamicWorkflowTools(config, fakeActions(), root)).map((spec) => spec.name);
    expect(names).not.toContain(`workflow_alpha-flow__${path.basename(secondWorkspace)}`);
  });
});
