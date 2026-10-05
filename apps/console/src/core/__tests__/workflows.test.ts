import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { createRole, deleteRole, loadInternalSkills, loadRoles, loadWorkflowCatalog, partialNodeClosure, saveRoleFile, saveWorkflowYaml, validateWorkflowGraph, workflowNodeRange } from "@/core/workflows/catalog";
import { parseJsonEnvelope } from "@/core/workflows/engine";
import { listRoadmapItems, saveRoadmapItem } from "@/core/workflows/roadmap";
import { buildSprintWorkflow, createSprint, parseTaskList } from "@/core/workflows/sprint";
import { WorkflowStore } from "@/core/workflows/storage";
import { workflowSchema } from "@/core/workflows/schema";
import { resolveCapabilityPolicy, workflowPreflight } from "@/core/workflows/preflight";
import { defaultState } from "@/core/state";
import { TOOLS } from "@/core/tools";
import { removeInputChip, removeOutputChip, renameStepInYaml } from "@/uikit/components/workflows/editor-shared";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-workflows-"));
  await mkdir(path.join(root, ".agents", "workflows"), { recursive: true });
  await mkdir(path.join(root, ".agents", "roles", "product"), { recursive: true });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const step = (id: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id,
  title: id.toUpperCase(),
  phase: "one",
  description: "",
  dependsOn: [],
  roles: ["worker-role"],
  runtime: { candidates: ["codex"], tier: "standard" as const, effort: "medium" as const },
  execution: { prompt: "сделай " + id, confirmPlan: false, producesTasks: false },
  inputs: [],
  outputs: [id],
  timeoutMs: 900_000,
  retry: { maxAttempts: 3 },
  resources: { workspace: "read" as const },
  ...extra,
});

const base = workflowSchema.parse({
  apiVersion: "harness/v1",
  kind: "Workflow",
  id: "base",
  title: "Base",
  nodes: [step("a"), step("b", { dependsOn: ["a"], inputs: ["a"] })],
});

describe("workflow catalog", () => {
  test("наследование переопределяет шаг по id", async () => {
    await writeFile(path.join(root, ".agents", "workflows", "base.yaml"), YAML.stringify(base));
    const child = { ...base, id: "child", title: "Child", extends: "base", nodes: [step("b", { title: "B2", dependsOn: ["a"], inputs: ["a"] })] };
    await writeFile(path.join(root, ".agents", "workflows", "child.yaml"), YAML.stringify(child));
    const catalog = await loadWorkflowCatalog(root);
    expect(catalog.get("child")?.value.nodes.find((node) => node.id === "b")?.title).toBe("B2");
    expect(catalog.get("child")?.value.nodes.find((node) => node.id === "a")).toBeTruthy();
  });

  test("DAG-цикл отклоняется", () => {
    const cyclic = { ...base, nodes: [step("a", { dependsOn: ["b"] }), step("b", { dependsOn: ["a"] })] };
    expect(validateWorkflowGraph(cyclic).some((error) => error.includes("цикл"))).toBe(true);
  });

  test("partial run включает зависимости", () => {
    expect(partialNodeClosure(base, ["b"])).toEqual(["a", "b"]);
    expect(partialNodeClosure(base, ["b"], new Set(["a"]))).toEqual(["b"]);
  });

  test("диапазон workflow выбирает шаги от start до end", () => {
    expect(workflowNodeRange(base, "b", "b")).toEqual(["b"]);
    expect(workflowNodeRange(base, "a", "b")).toEqual(["a", "b"]);
    expect(() => workflowNodeRange(base, "b", "a")).toThrow("раньше конечного");
  });

  test("ETag не даёт перезаписать внешний файл", async () => {
    const yaml = YAML.stringify(base);
    const saved = await saveWorkflowYaml({ root, fileName: "etag.yaml", yaml });
    await writeFile(saved.sourceFile, yaml + "\n# external\n");
    await expect(saveWorkflowYaml({ root, fileName: "etag.yaml", yaml, expectedEtag: saved.etag })).rejects.toThrow("вне Console");
  });

  test("несоединённый узел отклоняется", () => {
    const withOrphan = { ...base, nodes: [step("a"), step("b", { dependsOn: ["a"], inputs: ["a"] }), step("c")] };
    expect(validateWorkflowGraph(withOrphan).some((error) => error.includes("не соединён"))).toBe(true);
    expect(validateWorkflowGraph(base).every((error) => !error.includes("не соединён"))).toBe(true);
  });
});

describe("graph yaml helpers", () => {
  const graphYaml = YAML.stringify({
    apiVersion: "harness/v1",
    kind: "Workflow",
    id: "g",
    title: "G",
    nodes: [
      { id: "a", title: "A", phase: "p", dependsOn: [], roles: [], runtime: { candidates: [] }, execution: { prompt: "", confirmPlan: false }, inputs: [], outputs: ["a"] },
      { id: "b", title: "B", phase: "p", dependsOn: ["a"], roles: [], runtime: { candidates: [] }, execution: { prompt: "", confirmPlan: false }, inputs: ["a"], outputs: ["b"] },
    ],
  });

  test("renameStepInYaml обновляет id, dependsOn, входы и автоартефакты", () => {
    const doc = YAML.parse(renameStepInYaml(graphYaml, "a", "a1")!) as { nodes: Array<Record<string, unknown>> };
    expect(doc.nodes[0]!.id).toBe("a1");
    expect(doc.nodes[1]!.dependsOn).toEqual(["a1"]);
    expect(doc.nodes[1]!.inputs).toEqual(["a1"]);
  });

  test("removeInputChip убирает вход и разрывает связь", () => {
    const doc = YAML.parse(removeInputChip(graphYaml, "b", "a")!) as { nodes: Array<Record<string, unknown>> };
    expect(doc.nodes[1]!.inputs).toEqual([]);
    expect(doc.nodes[1]!.dependsOn).toEqual([]);
    expect(doc.nodes[0]!.outputs).toEqual(["a"]);
  });

  test("removeOutputChip чистит входы приёмника и связь", () => {
    const doc = YAML.parse(removeOutputChip(graphYaml, "a", "a")!) as { nodes: Array<Record<string, unknown>> };
    expect(doc.nodes[0]!.outputs).toEqual([]);
    expect(doc.nodes[1]!.inputs).toEqual([]);
    expect(doc.nodes[1]!.dependsOn).toEqual([]);
  });
});

describe("roles catalog", () => {
  const roleText = [
    "---",
    "apiVersion: harness/v1",
    "kind: Role",
    "id: worker-role",
    "title: Worker role",
    "domain: product",
    "skills: []",
    "mcp: []",
    "tools: []",
    "---",
    "",
    "# Роль",
    "",
    "Исполнитель работ.",
    "",
    "## Правила работы",
    "",
    "- алгоритм один",
    "",
    "## Принципы работы",
    "",
    "Действуй по назначению.",
    "",
    "## Оценка входных данных",
    "",
    "Проверь полноту.",
    "",
    "## Оценка своей работы",
    "",
    "Сверь с выходами.",
    "",
  ].join("\n");

  test("loadRoles читает frontmatter и тело из папок", async () => {
    await writeFile(path.join(root, ".agents", "roles", "product", "worker-role.md"), roleText);
    const roles = await loadRoles(root);
    const role = roles.find((item) => item.value.id === "worker-role");
    expect(role?.folder).toBe("product");
    expect(role?.value.title).toBe("Worker role");
    expect(role?.body).toContain("## Правила работы");
  });

  test("saveRoleFile конфликтует по etag и создаёт роль", async () => {
    const saved = await saveRoleFile({ root, folder: "product", id: "solo", text: roleText.replace("worker-role", "solo").replace("Worker role", "Solo") });
    await expect(saveRoleFile({ root, folder: "product", id: "solo", text: roleText, expectedEtag: "wrong" })).rejects.toThrow("вне Console");
    await expect(saveRoleFile({ root, folder: "product", id: "solo", text: roleText.replace("worker-role", "solo"), expectedEtag: saved.etag })).resolves.toBeDefined();
    await expect(saveRoleFile({ root, folder: "../escape", id: "bad", text: roleText })).rejects.toThrow("папка");
  });

  test("createRole и deleteRole управляют файлом роли", async () => {
    await createRole({ root, folder: "engineering", id: "new-role", title: "New" });
    const created = (await loadRoles(root)).find((item) => item.value.id === "new-role");
    expect(created?.folder).toBe("engineering");
    expect(created?.body).toContain("## Оценка своей работы");
    await expect(createRole({ root, folder: "engineering", id: "new-role" })).rejects.toThrow("уже существует");
    await deleteRole({ root, folder: "engineering", id: "new-role" });
    expect((await loadRoles(root)).some((item) => item.value.id === "new-role")).toBe(false);
  });
});

describe("shipped roles", () => {
  test("каталог содержит 64 содержательные уникальные роли", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../../..");
    const roles = await loadRoles(repoRoot);
    expect(roles).toHaveLength(64);
    expect(new Set(roles.map((role) => role.value.id)).size).toBe(64);
    for (const role of roles) {
      expect(role.body).toContain("# Роль");
      expect(role.body).toContain("## Правила работы");
      expect(role.body).toContain("## Принципы работы");
      expect(role.body).toContain("## Оценка входных данных");
      expect(role.body).toContain("## Оценка своей работы");
      expect((role.body.match(/^### Алгоритм/gm) ?? []).length).toBeGreaterThanOrEqual(3);
      for (const marker of ["**Capabilities.**", "**Fallback.**", "**Результат.**", "**Условие завершения.**"]) {
        expect(role.body).toContain(marker);
      }
      expect(role.body).not.toMatch(/Дополните|<Назначение|<Типовые|placeholder/i);
    }
  });

  test("обязательные ссылки frontmatter существуют", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../../..");
    const [roles, skills] = await Promise.all([loadRoles(repoRoot), loadInternalSkills(repoRoot)]);
    const skillIds = new Set(skills.map((skill) => skill.value.id));
    const toolIds = new Set(TOOLS.map((tool) => tool.id));
    for (const role of roles) {
      for (const skill of role.value.skills) expect(skillIds.has(skill)).toBe(true);
      for (const tool of role.value.tools) expect(toolIds.has(tool)).toBe(true);
    }
  });

  test("внутренние навыки содержат согласованный frontmatter и eval-наборы", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../../..");
    const skills = (await loadInternalSkills(repoRoot)).filter((skill) => (skill.group ?? "master") === "master");
    const expectedIds = ["codebase-research", "lessons-learned", "requirements-clarifier", "system-design"];
    expect(skills.map((skill) => skill.value.id).sort()).toEqual(expectedIds);

    for (const skill of skills) {
      const frontmatterMatch = skill.content.match(/^---\n([\s\S]*?)\n---\n/);
      expect(frontmatterMatch, `${skill.value.id}: отсутствует frontmatter`).not.toBeNull();
      const frontmatter = YAML.parse(frontmatterMatch![1]!) as {
        name?: string;
        description?: string;
        metadata?: { internal?: boolean };
      };
      expect(frontmatter.name).toBe(skill.value.id);
      expect(frontmatter.description).toBe(skill.value.description);
      expect(frontmatter.metadata?.internal).toBe(true);
      expect(skill.value.source.version).toBe("1.1.0");
      expect(skill.value.source.hash).toBe(`builtin-${skill.value.id}-2`);

      const evalPath = path.join(path.dirname(skill.sourceFile), "evals", "evals.json");
      const evalSet = JSON.parse(await readFile(evalPath, "utf8")) as {
        skill_name?: string;
        evals?: Array<{ id?: string; prompt?: string; expected_output?: string; assertions?: string[] }>;
      };
      expect(evalSet.skill_name).toBe(skill.value.id);
      expect(evalSet.evals).toHaveLength(3);
      expect(new Set(evalSet.evals?.map((item) => item.id)).size).toBe(3);
      for (const item of evalSet.evals ?? []) {
        expect(item.id?.trim().length).toBeGreaterThan(0);
        expect(item.prompt?.trim().length).toBeGreaterThan(0);
        expect(item.expected_output?.trim().length).toBeGreaterThan(0);
        expect(item.assertions?.length).toBeGreaterThanOrEqual(2);
        for (const assertion of item.assertions ?? []) expect(assertion.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("capability policy", () => {
  test("старый workflow snapshot получает policy block", () => {
    const legacy = workflowSchema.parse({
      ...base,
      resolution: { at: new Date().toISOString(), roles: {}, skills: {}, runtimes: {} },
    });
    expect(legacy.resolution?.capabilityPolicy).toBe("block");
    expect(legacy.resolution?.unavailableCapabilities).toEqual([]);
  });

  test("workflow перекрывает workspace и global policy", () => {
    const state = defaultState(root);
    state.settings.workflows.capabilities.defaultPolicy = "warn";
    state.settings.workflows.capabilities.workspacePolicies[root] = "block";
    expect(resolveCapabilityPolicy(base, root, state)).toBe("block");
    expect(resolveCapabilityPolicy({ ...base, defaults: { ...base.defaults, capabilityPolicy: "warn" } }, root, state)).toBe("warn");
    expect(resolveCapabilityPolicy(base, root + "-other", state)).toBe("warn");
  });

  test("skill, MCP и tool блокируют или предупреждают согласно policy", async () => {
    const role = [
      "---", "apiVersion: harness/v1", "kind: Role", "id: capability-role", "title: Capability role",
      "skills: [missing-skill]", "mcp: [missing-mcp]", "tools: [missing-tool]", "---", "",
      "# Роль", "", "Проверяет capability policy.", "", "## Правила работы", "", "Проверить зависимости.", "",
      "## Принципы работы", "", "Работать явно.", "", "## Оценка входных данных", "", "Проверить вход.", "",
      "## Оценка своей работы", "", "Проверить результат.", "",
    ].join("\n");
    await writeFile(path.join(root, ".agents", "roles", "product", "capability-role.md"), role);
    const state = defaultState(root);
    const workflow = workflowSchema.parse({ ...base, nodes: [step("capabilities", { roles: ["capability-role"], runtime: { candidates: [] } })] });
    const blocked = await workflowPreflight({ repoRoot: root, workspaceDir: root, workflow, state });
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.filter((issue) => issue.severity === "error").map((issue) => issue.capabilityKind).sort()).toEqual(["mcp", "skill", "tool"]);

    const warned = await workflowPreflight({ repoRoot: root, workspaceDir: root, workflow: { ...workflow, defaults: { ...workflow.defaults, capabilityPolicy: "warn" } }, state });
    expect(warned.ok).toBe(true);
    expect(warned.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.capabilityKind).sort()).toEqual(["mcp", "skill", "tool"]);
  });
});

describe("workflow store", () => {
  test("parseJsonEnvelope извлекает текст, usage и стоимость из конверта claude", () => {
    const log = [
      "Ignoring 1 permissions.allow entry from .claude/settings.json.",
      '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-1","result":"# Отчёт\\n\\nГотово.","total_cost_usd":0.0123,"usage":{"input_tokens":1500,"output_tokens":320,"cache_read_input_tokens":900}}',
    ].join("\n");
    const envelope = parseJsonEnvelope(log);
    expect(envelope?.result).toBe("# Отчёт\n\nГотово.");
    expect(envelope?.usage).toEqual({ input_tokens: 1500, output_tokens: 320, cache_read_input_tokens: 900 });
    expect(envelope?.costUsd).toBeCloseTo(0.0123);
    expect(envelope?.id).toBe("sess-1");
  });

  test("parseJsonEnvelope возвращает null для обычного текстового вывода", () => {
    expect(parseJsonEnvelope("Просто текст ответа\nвторая строка")).toBeNull();
    expect(parseJsonEnvelope('{"type":"system","data":1}')).toBeNull();
  });

  test("run, command и event сохраняются в SQLite", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Тест" });
    expect(store.getRun(run.id)?.status).toBe("queued");
    expect(store.takeCommands()[0]?.type).toBe("start");
    expect(store.listEvents(run.id).some((event) => event.type === "run.created")).toBe(true);
    store.close();
  });

  test("fork сохраняет capability policy и resolution исходного snapshot", () => {
    const store = new WorkflowStore(root, root);
    const snapshot = workflowSchema.parse({
      ...base,
      id: "warn-snapshot",
      resolution: {
        at: new Date().toISOString(),
        capabilityPolicy: "warn",
        unavailableCapabilities: [{ kind: "skill", id: "missing", roleId: "worker-role", stepId: "a", reason: "missing" }],
        roles: {}, skills: {}, runtimes: {},
      },
    });
    const source = store.createRun({ workspaceDir: root, workflow: snapshot, title: "Source" });
    const fork = store.createRun({ workspaceDir: root, workflow: source.snapshot, title: "Fork" });
    expect(fork.snapshot.resolution?.capabilityPolicy).toBe("warn");
    expect(fork.snapshot.resolution?.unavailableCapabilities).toEqual(source.snapshot.resolution?.unavailableCapabilities);
    store.close();
  });

  test("preflight warning сохраняется в ledger и остаётся привязан к шагу", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Warnings" });
    store.appendEvent(run.id, "run.preflight-warning", {
      severity: "warning", capabilityKind: "mcp", capabilityId: "figma", roleId: "ux-designer", message: "недоступен",
    }, { stepId: "b" });
    const warning = store.listEvents(run.id).find((event) => event.type === "run.preflight-warning");
    expect(warning?.stepId).toBe("b");
    expect(warning?.payload).toMatchObject({ severity: "warning", capabilityKind: "mcp", capabilityId: "figma", roleId: "ux-designer" });
    store.close();
  });

  test("countArtifacts считает циклы доработки по префиксу", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Счётчики" });
    store.saveArtifact(run.id, "a", "__work-1", "первый цикл");
    store.saveArtifact(run.id, "a", "__work-2", "второй цикл");
    store.saveArtifact(run.id, "a", "__rej-1", "отклонение");
    expect(store.countArtifacts(run.id, "a", "__work-")).toBe(2);
    expect(store.countArtifacts(run.id, "a", "__rej-")).toBe(1);
    expect(store.countArtifacts(run.id, "a", "__ret-tests-")).toBe(0);
    store.close();
  });

  test("provider receipt не учитывается дважды", () => {
    const store = new WorkflowStore(root, root);
    const usage = { receiptId: "receipt-1", runId: "run", stepId: "a", provider: "codex", inputTokens: 10, outputTokens: 5, raw: {} };
    expect(store.recordUsage(usage)).toBe(true);
    expect(store.recordUsage(usage)).toBe(false);
    store.close();
  });

  test("aggregates privacy удаляет текст из event ledger", () => {
    const store = new WorkflowStore(root, root);
    const workflow = workflowSchema.parse({ ...base, id: "private", defaults: { privacy: "aggregates" } });
    const run = store.createRun({ workspaceDir: root, workflow, title: "Privacy" });
    store.appendEvent(run.id, "privacy.test", { prompt: "секретный текст", count: 7, ok: true });
    const event = store.listEvents(run.id).find((item) => item.type === "privacy.test");
    expect(event?.payload).toEqual({ count: 7, ok: true });
    store.close();
  });

  test("metadata privacy замещает промт размером и хешем", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Метаданные" });
    store.appendEvent(run.id, "step.prompt", { prompt: "текст промта секции" }, { stepId: "a" });
    const event = store.listEvents(run.id).find((item) => item.type === "step.prompt");
    const prompt = event?.payload.prompt as { size: number; hash: string };
    expect(prompt.size).toBeGreaterThan(0);
    expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
    store.close();
  });

  test("stepEndStates возвращает последнее конечное событие шага", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Состояния" });
    store.appendEvent(run.id, "step.completed", {}, { stepId: "a" });
    store.appendEvent(run.id, "step.failed", { error: "x" }, { stepId: "b" });
    store.appendEvent(run.id, "step.completed", {}, { stepId: "a" });
    const states = Object.fromEntries(store.stepEndStates(run.id).map((row) => [row.stepId, row.type]));
    expect(states.a).toBe("step.completed");
    expect(states.b).toBe("step.failed");
    store.close();
  });

  test("clearRunArtifacts стирает исполнение и хранит находки для уроков", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Очистка" });
    store.saveArtifact(run.id, "a", "a", "выход шага");
    store.saveArtifact(run.id, "a", "__work-0", "цикл");
    store.saveArtifact(run.id, "a", "__plan-0", "план");
    store.saveArtifact(run.id, "a", "__err-1", "ошибка шага");
    store.saveArtifact(run.id, "a", "__ret-accept-1", "возврат приёмки");
    store.saveArtifact(run.id, "b", "__ret-input-1", "возврат входа");
    store.saveArtifact(run.id, "b", "xxerr-note", "выход с похожим именем");
    store.saveArtifact(run.id, "lessons", "__lessons-proposals", "[]");
    store.clearRunArtifacts(run.id);
    const names = store.listStepArtifacts(run.id, "a").map((row) => String(row.name));
    expect(names).toContain("__err-1");
    expect(names).toContain("__ret-accept-1");
    expect(names).not.toContain("a");
    expect(names).not.toContain("__work-0");
    expect(names).not.toContain("__plan-0");
    expect(store.listStepArtifacts(run.id, "b").map((row) => String(row.name))).toEqual(["__ret-input-1"]);
    expect(store.latestArtifact(run.id, "lessons", "__lessons-proposals")).toBeTruthy();
    store.close();
  });

  test("clearRunArtifacts с keepStepIds хранит успешные шаги целиком", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Очистка частичная" });
    store.saveArtifact(run.id, "a", "a", "выход первого шага");
    store.saveArtifact(run.id, "b", "b", "частичный выход второго шага");
    store.saveArtifact(run.id, "b", "__work-0", "цикл второго шага");
    store.clearRunArtifacts(run.id, { keepStepIds: ["a"] });
    expect(store.listStepArtifacts(run.id, "a").map((row) => String(row.name))).toEqual(["a"]);
    expect(store.listStepArtifacts(run.id, "b")).toEqual([]);
    store.close();
  });

  test("deleteRunThread сбрасывает чекпоинт и записи потока", () => {
    const store = new WorkflowStore(root, root);
    store.deleteRunThread("run-thread");
    store.db.prepare("INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id) VALUES ('run-thread', '', 'c1')").run();
    store.db.prepare("INSERT INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel) VALUES ('run-thread', '', 'c1', 't1', 0, 'artifacts')").run();
    store.deleteRunThread("run-thread");
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM checkpoints WHERE thread_id = 'run-thread'").get()).toEqual({ count: 0 });
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM writes WHERE thread_id = 'run-thread'").get()).toEqual({ count: 0 });
    store.close();
  });

  test("attempts пишут role_id и section", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Attempts" });
    const attemptId = store.beginAttempt(run.id, "a", { runtime: "codex", roles: ["worker-role"], section: "исполнение", skills: [], mcp: [] });
    store.finishAttempt(attemptId, "completed");
    const attempt = store.listAttempts(run.id).find((item) => (item as Record<string, unknown>).id === attemptId) as Record<string, unknown> | undefined;
    expect(attempt?.role_id).toBe("worker-role");
    expect(attempt?.section).toBe("исполнение");
    store.close();
  });

  test("статистика агрегирует по workflow и шагам", () => {
    const store = new WorkflowStore(root, root);
    const run = store.createRun({ workspaceDir: root, workflow: base, title: "Статистика" });
    const attemptId = store.beginAttempt(run.id, "a", { runtime: "codex", roles: ["worker-role"], section: "исполнение", skills: [], mcp: [] });
    store.finishAttempt(attemptId, "completed", null, { inputTokens: 10, outputTokens: 5, cacheTokens: 0 });
    const stats = store.stats();
    expect((stats.runsByWorkflow as Array<Record<string, unknown>>).some((row) => row.workflow === "base" && Number(row.runs) >= 1)).toBe(true);
    expect((stats.byStep as Array<Record<string, unknown>>).some((row) => row.step === "a" && row.section === "исполнение")).toBe(true);
    store.close();
  });
});

describe("sprints", () => {
  const item = (id: string, title: string) => ({
    apiVersion: "harness/v1", kind: "RoadmapItem", id, title, description: "", type: "task",
    status: "inbox", priority: "normal", labels: [], dependencies: [], acceptanceCriteria: [],
    runIds: [], taskRefs: [], provenance: { source: "test" },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  test("parseTaskList читает финальный json-блок", () => {
    const output = 'текст\n```json\n[{"title":"A","description":"дело","value":3,"effort":2}]\n```';
    expect(parseTaskList(output)).toEqual([{ title: "A", description: "дело", value: 3, effort: 2 }]);
    expect(parseTaskList("без блока")).toEqual([]);
  });

  test("createSprint помечает задачи лейблом и строит служебный граф", async () => {
    await saveRoadmapItem(root, item("TASK-1", "Первая"));
    await saveRoadmapItem(root, item("TASK-2", "Вторая"));
    const sprint = await createSprint(root, {
      title: "Спринт 1",
      rows: [
        { itemId: "TASK-1", workflowId: "base", bucket: 1, order: 0 },
        { itemId: "TASK-2", workflowId: "base", bucket: 2, order: 0 },
      ],
    });
    const items = await listRoadmapItems(root);
    expect(items.find((candidate) => candidate.id === "TASK-1")?.labels).toContain("sprint:" + sprint.id);
    expect(items.find((candidate) => candidate.id === "TASK-1")?.status).toBe("ready");
    const workflow = buildSprintWorkflow(sprint);
    expect(workflow.nodes.map((node) => node.id)).toEqual(["worktrees", "bucket-1", "bucket-2", "close", "lessons"]);
    expect(workflow.nodes.filter((node) => node.hidden).length).toBe(3);
    expect(workflow.nodes.find((node) => node.id === "bucket-1")?.bucket).toBe(1);
  });

  test("задача не попадает в два спринта", async () => {
    await expect(createSprint(root, { title: "S2", rows: [{ itemId: "TASK-1", workflowId: "base", bucket: 1, order: 0 }] })).rejects.toThrow("уже в спринте");
  });
});
