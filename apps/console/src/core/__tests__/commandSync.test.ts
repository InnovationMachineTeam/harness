import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { COMMAND_SYNC_TARGETS, planRuntimeCommands, runtimeCommandName, syncRuntimeCommands, commandSyncStatus } from "../commandSync";
import { workflowSchema } from "../workflows/schema";
import type { ConsoleStateLike } from "../skills";

let root = "";

const state: ConsoleStateLike = { skills: { useGlobal: true, defaults: {}, runtimeOverrides: {} } };

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

async function writeManifest(dir: string, id: string, runtimes: string[]): Promise<void> {
  await mkdir(path.join(root, dir, id), { recursive: true });
  await writeFile(
    path.join(root, dir, id, "manifest.yaml"),
    [
      "apiVersion: harness/v1",
      "kind: InternalSkill",
      `id: ${id}`,
      `title: ${id}`,
      `description: Навык ${id}`,
      "source:",
      '  version: "1.0.0"',
      "  hash: sha256:test",
      "  update: manual-review",
      `runtimes: [${runtimes.join(", ")}]`,
      "tags: [test]",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(root, dir, id, "SKILL.md"), `# ${id}\nИнструкция навыка.`);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-command-sync-"));
  await writeManifest(".agents/skills/master/skills", "demo-skill", ["claude", "zcode", "codex", "kimi"]);
  await writeManifest(".agents/skills/design/skills", "demo-design", ["claude"]);
  const workflow = workflowSchema.parse({
    apiVersion: "harness/v1",
    kind: "Workflow",
    id: "demo-flow",
    title: "Demo Flow",
    nodes: [step("a"), step("b", { dependsOn: ["a"] })],
  });
  await mkdir(path.join(root, ".agents", "skills", "master", "workflows"), { recursive: true });
  await writeFile(path.join(root, ".agents", "skills", "master", "workflows", "demo-flow.yaml"), YAML.stringify(workflow));
  // конвенция имён файлов: двоеточие id заменяется точкой
  const colonWorkflow = workflowSchema.parse({ ...workflow, id: "demo:colon", title: "Demo Colon", nodes: [step("a")] });
  await writeFile(path.join(root, ".agents", "skills", "master", "workflows", "demo.colon.yaml"), YAML.stringify(colonWorkflow));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("runtimeCommandName", () => {
  test("подпапка даёт имя с двоеточием", () => {
    const claude = COMMAND_SYNC_TARGETS.find((target) => target.runtime === "claude")!;
    expect(runtimeCommandName(claude, "master", "demo-skill")).toEqual({ relFile: "master/demo-skill.md", invocation: "/master:demo-skill" });
    expect(runtimeCommandName(claude, "workflow", "demo-flow")).toEqual({ relFile: "workflow/demo-flow.md", invocation: "/workflow:demo-flow" });
    expect(runtimeCommandName(claude, "master")).toEqual({ relFile: "master.md", invocation: "/master" });
  });

  test("плоский рантайм даёт имя с дефисом", () => {
    const cursor = COMMAND_SYNC_TARGETS.find((target) => target.runtime === "cursor")!;
    expect(runtimeCommandName(cursor, "master", "demo-skill")).toEqual({ relFile: "master-demo-skill.md", invocation: "/master-demo-skill" });
    expect(runtimeCommandName(cursor, "workflow", "demo-flow")).toEqual({ relFile: "workflow-demo-flow.md", invocation: "/workflow-demo-flow" });
  });

  test("codex и kimi получают команды навыками", () => {
    const codex = COMMAND_SYNC_TARGETS.find((target) => target.runtime === "codex")!;
    const kimi = COMMAND_SYNC_TARGETS.find((target) => target.runtime === "kimi")!;
    expect(runtimeCommandName(codex, "workflow", "demo-flow")).toEqual({ relFile: "workflow-demo-flow/SKILL.md", invocation: "/workflow-demo-flow" });
    expect(runtimeCommandName(codex, "master")).toEqual({ relFile: "master/SKILL.md", invocation: "/master" });
    expect(runtimeCommandName(kimi, "master", "demo-skill")).toEqual({ relFile: "master-demo-skill/SKILL.md", invocation: "/skill:master-demo-skill" });
    expect(runtimeCommandName(kimi, "workflow")).toEqual({ relFile: "workflow/SKILL.md", invocation: "/skill:workflow" });
  });
});

describe("planRuntimeCommands", () => {
  test("мастер-навык попадает только к привязанным рантаймам, workflow - ко всем", async () => {
    const plan = await planRuntimeCommands(root, state);
    const claude = plan.get("claude")!.map((command) => command.relFile);
    const zcode = plan.get("zcode")!.map((command) => command.relFile);
    const cursor = plan.get("cursor")!.map((command) => command.relFile);
    expect(claude).toContain("master/demo-skill.md");
    expect(claude).toContain("master/demo-design.md");
    expect(zcode).toContain("master/demo-skill.md");
    expect(zcode).not.toContain("master/demo-design.md");
    // demo-skill не привязан к cursor - команды навыка у cursor нет
    expect(cursor).not.toContain("master-demo-skill.md");
    // workflow попадает всем: у claude/zcode с двоеточием, у cursor плоско
    expect(claude).toContain("workflow/demo-flow.md");
    expect(zcode).toContain("workflow/demo-flow.md");
    expect(cursor).toContain("workflow-demo-flow.md");
    // codex и kimi - навыками; demo-design к ним не привязан
    const codex = plan.get("codex")!.map((command) => command.relFile);
    const kimi = plan.get("kimi")!.map((command) => command.relFile);
    expect(codex).toContain("master-demo-skill/SKILL.md");
    expect(codex).not.toContain("master-demo-design/SKILL.md");
    expect(codex).toContain("workflow-demo-flow/SKILL.md");
    expect(kimi).toContain("master-demo-skill/SKILL.md");
    expect(kimi).toContain("workflow-demo-flow/SKILL.md");
    // общие команды есть у всех
    expect(claude).toContain("master.md");
    expect(claude).toContain("workflow.md");
    expect(cursor).toContain("master.md");
  });

  test("выключенный тогглом design-навык уходит из плана", async () => {
    const off: ConsoleStateLike = { skills: { useGlobal: true, defaults: { "design:demo-design": false }, runtimeOverrides: {} } };
    const plan = await planRuntimeCommands(root, off);
    const claude = plan.get("claude")!.map((command) => command.relFile);
    expect(claude).not.toContain("master/demo-design.md");
    expect(claude).toContain("master/demo-skill.md");
  });

  test("двоеточие в id workflow заменяется точкой в имени файла", async () => {
    const plan = await planRuntimeCommands(root, state);
    const command = plan.get("claude")!.find((item) => item.id === "demo:colon")!;
    expect(command.relFile).toBe("workflow/demo.colon.md");
    expect(command.invocation).toBe("/workflow:demo.colon");
    expect(command.content).toContain(".agents/skills/master/workflows/demo.colon.yaml");
  });

  test("тело команды ведёт на SKILL.md и содержит $ARGUMENTS", async () => {
    const plan = await planRuntimeCommands(root, state);
    const command = plan.get("claude")!.find((item) => item.relFile === "master/demo-skill.md")!;
    expect(command.content).toContain(".agents/skills/master/skills/demo-skill/SKILL.md");
    expect(command.content).toContain("$ARGUMENTS");
    expect(command.content).toContain("---");
  });
});

describe("syncRuntimeCommands: skills-доставка (codex, kimi)", () => {
  test("записывает SKILL.md с frontmatter, очищает устаревшие каталоги и не трогает чужие", async () => {
    const reports = await syncRuntimeCommands(root, state);
    const kimiReport = reports.find((report) => report.runtime === "kimi")!;
    expect(kimiReport.error).toBeUndefined();
    const kimiDir = path.join(root, ".kimi-code", "skills");
    const kimiSkill = await readFile(path.join(kimiDir, "workflow-demo-flow", "SKILL.md"), "utf8");
    expect(kimiSkill.startsWith("---\nname: workflow-demo-flow\n")).toBe(true);
    expect(kimiSkill).toContain("$ARGUMENTS");
    expect(kimiSkill).toContain(".agents/skills/master/workflows/demo-flow.yaml");
    // codex: задача - текст после вызова, $ARGUMENTS не используется
    const codexSkill = await readFile(path.join(root, ".codex", "skills", "master-demo-skill", "SKILL.md"), "utf8");
    expect(codexSkill).toContain("---\nname: master-demo-skill\n");
    expect(codexSkill).not.toContain("$ARGUMENTS");
    expect(codexSkill).toContain("текст, следующий за вызовом команды");

    // чужой каталог навыка не трогается
    await mkdir(path.join(kimiDir, "own-skill"), { recursive: true });
    await writeFile(path.join(kimiDir, "own-skill", "SKILL.md"), "---\nname: own-skill\ndescription: свой\n---\nтело");
    // выключение навыка убирает его каталог
    const off: ConsoleStateLike = { skills: { useGlobal: true, defaults: { "master:demo-skill": false }, runtimeOverrides: {} } };
    const reportsOff = await syncRuntimeCommands(root, off);
    const kimiOff = reportsOff.find((report) => report.runtime === "kimi")!;
    expect(kimiOff.removed).toContain(".kimi-code/skills/master-demo-skill/SKILL.md");
    await expect(readFile(path.join(kimiDir, "master-demo-skill", "SKILL.md"), "utf8")).rejects.toThrow();
    // чужой каталог остался
    expect(await readFile(path.join(kimiDir, "own-skill", "SKILL.md"), "utf8")).toContain("тело");
  });
});

describe("syncRuntimeCommands", () => {
  test("записывает команды, помечает маркером и убирает устаревшие, не трогая чужие файлы", async () => {
    const reports = await syncRuntimeCommands(root, state);
    const claudeReport = reports.find((report) => report.runtime === "claude")!;
    expect(claudeReport.error).toBeUndefined();
    const claudeDir = path.join(root, ".claude", "commands");
    const skillFile = await readFile(path.join(claudeDir, "master", "demo-skill.md"), "utf8");
    expect(skillFile.startsWith("<!-- generated by harness console")).toBe(true);
    expect(await readFile(path.join(claudeDir, "master.md"), "utf8")).toContain("Каталоги навыков");
    expect(await readdir(path.join(claudeDir, "workflow"))).toContain("demo-flow.md");

    // чужой файл синк не удаляет
    await writeFile(path.join(claudeDir, "own-command.md"), "свой файл");
    const reports2 = await syncRuntimeCommands(root, state);
    expect(reports2.find((report) => report.runtime === "claude")!.written).toHaveLength(0);
    expect(await readFile(path.join(claudeDir, "own-command.md"), "utf8")).toBe("свой файл");

    // выключение навыка убирает его команду у привязанных рантаймов
    const off: ConsoleStateLike = { skills: { useGlobal: true, defaults: { "master:demo-skill": false }, runtimeOverrides: {} } };
    const reports3 = await syncRuntimeCommands(root, off);
    const zcodeReport = reports3.find((report) => report.runtime === "zcode")!;
    expect(zcodeReport.removed).toContain(".zcode/commands/master/demo-skill.md");
    await expect(readFile(path.join(root, ".zcode", "commands", "master", "demo-skill.md"), "utf8")).rejects.toThrow();
    // у claude навык выключен только по умолчанию - оверлей рантайма вернул бы его;
    // здесь override нет, так что файл удалён и там
    await expect(readFile(path.join(claudeDir, "master", "demo-skill.md"), "utf8")).rejects.toThrow();
    // чужой файл остался
    expect(await readFile(path.join(claudeDir, "own-command.md"), "utf8")).toBe("свой файл");
  });

  test("commandSyncStatus показывает расхождение до синка", async () => {
    // файл удалён вне синка - статус отмечает команду как отсутствующую
    await rm(path.join(root, ".opencode", "command", "workflow-demo-flow.md"));
    const status = await commandSyncStatus(root, state);
    const opencode = status.find((entry) => entry.runtime === "opencode")!;
    const stale = opencode.commands.filter((command) => !command.present);
    expect(stale.map((command) => command.invocation)).toEqual(["/workflow-demo-flow"]);
    expect(opencode.commands.find((command) => command.invocation === "/master")).toBeTruthy();
  });
});
