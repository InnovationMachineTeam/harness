import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defaultHarnessMcpConfig,
  exposedWorkspaces,
  harnessMcpConfigPath,
  loadHarnessMcpConfig,
  parseHarnessMcpConfig,
  saveHarnessMcpConfig,
} from "@/mcp-server/config";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-mcp-config-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("конфиг MCP-сервера harness", () => {
  test("значения по умолчанию: все группы кроме monitoring, динамика включена", () => {
    const config = defaultHarnessMcpConfig();
    expect(config.workspaces).toBe("all");
    expect(config.groups.prompts).toBe(true);
    expect(config.groups.monitoring).toBe(false);
    expect(config.monitoring.stopProcesses).toBe(false);
    expect(config.workflowTools).toEqual({ enabled: true, workflows: "all" });
  });

  test("разбор файла: валидные ключи применяются, невалидные заменяются значениями по умолчанию", () => {
    const parsed = parseHarnessMcpConfig({
      workspaces: ["/tmp/a", "относительный-путь", 42],
      groups: { prompts: false, monitoring: true, unknown: true },
      monitoring: { stopProcesses: true },
      workflowTools: { enabled: false, workflows: ["sdlc", ""] },
    });
    expect(parsed.workspaces).toEqual(["/tmp/a"]);
    expect(parsed.groups.prompts).toBe(false);
    expect(parsed.groups.monitoring).toBe(true);
    expect(parsed.groups.knowledge).toBe(true);
    expect(parsed.monitoring.stopProcesses).toBe(true);
    expect(parsed.workflowTools).toEqual({ enabled: false, workflows: ["sdlc"] });
  });

  test("загрузка без файла - значения по умолчанию; запись и перечитывание работают", async () => {
    const missing = await loadHarnessMcpConfig(root);
    expect(missing).toEqual(defaultHarnessMcpConfig());

    const config = defaultHarnessMcpConfig();
    config.groups.sessions = false;
    config.workspaces = ["/tmp/a"];
    await saveHarnessMcpConfig(root, config);
    expect(await loadHarnessMcpConfig(root)).toEqual(config);
    expect(path.basename(harnessMcpConfigPath(root))).toBe("mcp-server.json");
  });

  test("env-переопределения: группы и рабочие папки", async () => {
    await mkdir(path.dirname(harnessMcpConfigPath(root)), { recursive: true });
    await writeFile(harnessMcpConfigPath(root), JSON.stringify(defaultHarnessMcpConfig()), "utf8");
    const byGroups = await loadHarnessMcpConfig(root, { HARNESS_MCP_GROUPS: "prompts, catalog" });
    expect(byGroups.groups.prompts).toBe(true);
    expect(byGroups.groups.catalog).toBe(true);
    expect(byGroups.groups.workflows).toBe(false);
    const byWorkspaces = await loadHarnessMcpConfig(root, { HARNESS_MCP_WORKSPACES: "/tmp/x,/tmp/y" });
    expect(byWorkspaces.workspaces).toEqual(["/tmp/x", "/tmp/y"]);
  });

  test("экспонируемые папки - пересечение списка конфига с рабочими папками", () => {
    const config = defaultHarnessMcpConfig();
    config.workspaces = ["/tmp/a", "/tmp/чужая"];
    expect(exposedWorkspaces(config, ["/tmp/a", "/tmp/b"])).toEqual(["/tmp/a"]);
    expect(exposedWorkspaces({ ...config, workspaces: "all" }, ["/tmp/a", "/tmp/b"])).toEqual(["/tmp/a", "/tmp/b"]);
  });
});
