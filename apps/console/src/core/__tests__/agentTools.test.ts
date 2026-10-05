import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BUILTIN_TOOL_SPECS, capToolOutput, executeTool, guardVerdict, type ToolContext } from "@/core/agentTools";
import { mcpQualifiedName, parseMcpQualifiedName } from "@/core/mcp/client";

/** Корень репозитория: guard-проверка run_command выполняется на настоящей политике. */
const repoRoot = resolve(import.meta.dir, "../../../../..");

let dir: string;
let ctx: ToolContext;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

async function makeFixture(): Promise<ToolContext> {
  dir = await mkdtemp(join(tmpdir(), "agent-tools-"));
  await writeFile(join(dir, "a.txt"), "line-1\nline-2\nline-3\n", "utf8");
  await mkdir(join(dir, "sub"), { recursive: true });
  await writeFile(join(dir, "sub", "b.md"), "# b\n", "utf8");
  return { cwd: dir, repoRoot };
}

describe("executeTool: read_file", () => {
  test("читает файл с номерами строк", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "read_file", { path: "a.txt" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("line-2");
    expect(result.output).toContain("1\t");
  });

  test("offset и limit выбирают кусок", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "read_file", { path: "a.txt", offset: 2, limit: 1 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("line-2");
    expect(result.output).not.toContain("line-1");
  });

  test("путь вне рабочей папки отклоняется", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "read_file", { path: "../outside.txt" });
    expect(result.blocked).toBe(true);
    expect(result.output).toContain("вне рабочей папки");
  });

  test("секретный путь запрещён политикой", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "read_file", { path: ".env" });
    expect(result.blocked).toBe(true);
    expect(result.output).toContain("секретного пути");
  });

  test("неизвестный инструмент - ошибка результата", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "write_file", {});
    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
  });
});

describe("executeTool: list_dir", () => {
  test("показывает записи каталога с типами и размерами", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "list_dir", {});
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.txt");
    expect(result.output).toContain("sub/");
  });
});

describe("executeTool: run_command", () => {
  test("исполняет команду и возвращает вывод", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "run_command", { command: "echo hello-agent" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello-agent");
  });

  test("ненулевой код выхода отмечается в результате", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "run_command", { command: "exit 3" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("3");
  });

  test("guard-блок возвращается модели как отклонённый вызов", async () => {
    ctx = await makeFixture();
    const result = await executeTool(ctx, "run_command", { command: "rm -rf /" });
    expect(result.blocked).toBe(true);
    expect(result.output).toContain("guard-политикой");
  });

  test("отсутствующий guard - fail-closed", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-tools-noguard-"));
    const result = await executeTool({ cwd: dir, repoRoot: dir }, "run_command", { command: "echo hi" });
    expect(result.blocked).toBe(true);
  });

  test("guardVerdict пропускает безопасную команду", () => {
    const verdict = guardVerdict(repoRoot, "echo probe");
    expect(verdict.allowed).toBe(true);
  });
});

describe("встроенные схемы инструментов", () => {
  test("три инструмента с обязательными полями", () => {
    expect(BUILTIN_TOOL_SPECS.map((spec) => spec.name)).toEqual(["read_file", "list_dir", "run_command"]);
    for (const spec of BUILTIN_TOOL_SPECS) {
      expect(spec.parameters.type).toBe("object");
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });
});

describe("capToolOutput", () => {
  test("короткий текст не меняется", () => {
    expect(capToolOutput("short")).toBe("short");
  });

  test("длинный текст усекается с сохранением начала и конца", () => {
    const text = "HEAD" + "A".repeat(20_000) + "B".repeat(20_000) + "TAIL";
    const capped = capToolOutput(text);
    expect(capped.length).toBeLessThan(text.length);
    expect(capped).toContain("усечён");
    expect(capped).toContain("HEAD");
    expect(capped).toContain("TAIL");
  });
});

describe("пространство имён MCP", () => {
  test("сборка и разбор полного имени", () => {
    const name = mcpQualifiedName("fs", "read_file");
    expect(name).toBe("mcp__fs__read_file");
    expect(parseMcpQualifiedName(name)).toEqual({ server: "fs", tool: "read_file" });
  });

  test("чужие имена не разбираются", () => {
    expect(parseMcpQualifiedName("read_file")).toBeNull();
    expect(parseMcpQualifiedName("mcp__server")).toBeNull();
  });
});
