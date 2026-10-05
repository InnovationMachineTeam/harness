import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "@/core/state";
import {
  TOOLS,
  effectiveToolState,
  globalInstallCommand,
  readPackageManagerPref,
  toolById,
  toolRuntimeInstalled,
  writePackageManagerPref,
  writeToolsEnv,
} from "@/core/tools";
import { mcpPresetsForPm } from "@/core/plugins";
import { sanitizeToolParams } from "@/core/toolActions";
import type { ToolInstallParams } from "@/core/state";

const params = (p: Partial<ToolInstallParams> = {}): ToolInstallParams => ({
  scope: "global",
  mode: "wrap",
  ...p,
});

describe("реестр инструментов", () => {
  test("11 инструментов с уникальными id и бинарями", () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual(
      ["agentplane", "codeburn", "codegraph", "graphify", "headroom", "nx", "open-design", "openwiki", "qmd", "rtk", "serena"].sort(),
    );
    expect(new Set(TOOLS.map((t) => t.bin)).size).toBe(TOOLS.length);
  });

  test("codeburn: npm-глобальная установка выбранным PM, без per-runtime интеграций", () => {
    const tool = toolById("codeburn");
    expect(tool?.bin).toBe("codeburn");
    expect(tool?.systemInstall("bun", "darwin")).toEqual(["bun", "add", "-g", "codeburn"]);
    expect(tool?.systemInstall("npm", "linux")).toEqual(["npm", "install", "-g", "codeburn"]);
    expect(tool?.perRuntime?.supported).toEqual([]);
  });

  test("unsupported-матрица: rtk/codegraph не поддерживают zcode, rtk также codex; headroom без cursor; nx без per-runtime", () => {
    expect(toolById("rtk")?.perRuntime?.supported).not.toContain("zcode");
    expect(toolById("rtk")?.perRuntime?.supported).not.toContain("codex"); // rtk 0.39.x: нет --codex
    expect(toolById("rtk")?.perRuntime?.notes?.codex).toBeTruthy();
    expect(toolById("codegraph")?.perRuntime?.supported).not.toContain("zcode");
    expect(toolById("headroom")?.perRuntime?.supported).not.toContain("cursor");
    expect(toolById("headroom")?.uninstallStopsDashboard).toBe(true);
    expect(toolById("graphify")?.perRuntime?.supported).toContain("zcode"); // generic agents
    expect(toolById("nx")?.perRuntime?.supported).toEqual([]); // чистый CLI, без интеграций в конфиги рантаймов
    expect(toolById("open-design")?.perRuntime?.supported).toEqual(["claude", "codex", "cursor", "kimi", "opencode"]);
  });

  test("open-design: MCP preset использует актуальный od mcp --daemon-url", () => {
    const def = toolById("open-design")!;
    expect(def.bin).toBe("od");
    expect(def.category).toBe("design");
    expect(def.systemInstall("bun", "darwin")).toBeNull(); // desktop-приложение ставится вручную
    expect(def.mcpPreset?.(params())).toEqual({
      type: "stdio",
      command: "od",
      args: ["mcp", "--daemon-url", "http://127.0.0.1:7456"],
    });
    expect(def.perRuntime!.installCommand("claude", params())).toEqual(["od", "mcp", "install", "claude"]);
    expect(def.perRuntime!.uninstallCommand("cursor")).toEqual(["od", "mcp", "install", "cursor", "--uninstall"]);
  });

  test("agentplane: системная установка и встроенный fallback без per-runtime конфигов", () => {
    const def = toolById("agentplane")!;
    expect(def.bin).toBe("agentplane");
    expect(def.systemInstall("bun", "darwin")).toEqual(["bun", "add", "-g", "agentplane"]);
    expect(def.perRuntime).toBeUndefined();
  });

  test("install-команды graphify: платформа + scope + strict (только claude)", () => {
    const def = toolById("graphify")!;
    expect(def.perRuntime!.installCommand("claude", params())).toEqual([
      "graphify",
      "install",
      "--platform",
      "claude",
    ]);
    expect(def.perRuntime!.installCommand("zcode", params({ scope: "project" }))).toEqual([
      "graphify",
      "install",
      "--platform",
      "agents",
      "--project",
    ]);
    expect(def.perRuntime!.installCommand("kimi", params({ strict: true }))).toEqual([
      "graphify",
      "install",
      "--platform",
      "kimi",
    ]);
    expect(def.perRuntime!.installCommand("claude", params({ strict: true }))).toEqual([
      "graphify",
      "install",
      "--platform",
      "claude",
      "--strict",
    ]);
  });

  test("rtk: scope-toggle - global с -g, project без -g; kimi всегда project-scoped", () => {
    const def = toolById("rtk")!;
    expect(def.perRuntime!.installCommand("claude", params())).toEqual(["rtk", "init", "-g", "--auto-patch"]);
    expect(def.perRuntime!.installCommand("claude", params({ scope: "project" }))).toEqual([
      "rtk",
      "init",
      "--auto-patch",
    ]);
    expect(def.perRuntime!.installCommand("opencode", params())).toEqual(["rtk", "init", "-g", "--opencode"]);
    expect(def.perRuntime!.installCommand("opencode", params({ scope: "project" }))).toEqual([
      "rtk",
      "init",
      "--opencode",
    ]);
    expect(def.perRuntime!.installCommand("kimi", params())).toEqual(["rtk", "init", "--agent", "kimi"]);
    expect(def.perRuntime!.installCommand("cursor", params({ scope: "project" }))).toEqual([
      "rtk",
      "init",
      "--agent",
      "cursor",
    ]);
    // uninstall всегда с -g (требование rtk CLI)
    expect(def.perRuntime!.uninstallCommand("claude")).toEqual(["rtk", "init", "--uninstall", "-g"]);
    expect(def.perRuntime!.uninstallCommand("kimi")).toEqual(["rtk", "init", "--uninstall", "-g", "--agent", "kimi"]);
    expect(def.perRuntime!.uninstallCommand("opencode")).toEqual(["rtk", "init", "--uninstall", "-g", "--opencode"]);
  });

  test("санитайзер параметров: project - область по умолчанию", () => {
    expect(sanitizeToolParams({}).scope).toBe("project");
    expect(sanitizeToolParams({ scope: "global" }).scope).toBe("global");
    expect(sanitizeToolParams(undefined).scope).toBe("project");
  });

  test("headroom: интеграция = detached-прокси на всех рантаймов, MCP при mode=mcp", () => {
    const def = toolById("headroom")!;
    expect(def.dashboardCommand).toEqual(["headroom", "proxy", "--port", "8787"]);
    expect(def.perRuntime?.detachedInstall).toBe(true);
    expect(def.perRuntime?.supported).toContain("zcode");
    // installCommand пуст - сервис запускается одним detached-шагом
    expect(def.perRuntime!.installCommand("claude", params({ mode: "wrap" }))).toEqual([]);
    expect(def.mcpPreset?.(params({ mode: "wrap" }))).toBeNull();
    const mcp = def.mcpPreset?.(params({ mode: "mcp" }));
    expect(mcp).toEqual({
      type: "stdio",
      command: "headroom",
      args: ["mcp", "serve", "--proxy-url", "http://127.0.0.1:8787"],
    });
  });

  test("PM-параметризация системных пакетов", () => {
    expect(toolById("qmd")!.systemInstall("bun", "darwin")).toEqual(["bun", "add", "-g", "@tobilu/qmd"]);
    expect(toolById("qmd")!.systemInstall("npm", "linux")).toEqual(["npm", "install", "-g", "@tobilu/qmd"]);
    expect(toolById("rtk")!.systemInstall("bun", "linux")).toBeNull(); // linux - вручную
    expect(toolById("serena")!.systemInstall("npm", "darwin")).toEqual([
      "uv",
      "tool",
      "install",
      "-p",
      "3.13",
      "serena-agent",
    ]);
    expect(toolById("nx")!.systemInstall("bun", "darwin")).toEqual(["bun", "add", "-g", "nx"]);
    expect(toolById("nx")!.systemInstall("npm", "linux")).toEqual(["npm", "install", "-g", "nx"]);
  });

  test("npx-пресеты адаптируются под bun (без -y), http - не изменяются", () => {
    const bun = mcpPresetsForPm("bun");
    const context7 = bun.find((p) => p.name === "context7")!;
    expect(context7.transport).toEqual({ type: "stdio", command: "bunx", args: ["@upstash/context7-mcp"] });
    const deepwiki = bun.find((p) => p.name === "deepwiki")!;
    expect(deepwiki.transport).toEqual({ type: "http", url: "https://mcp.deepwiki.com/" });
    const figma = bun.find((p) => p.name === "figma")!;
    expect(figma.transport).toEqual({ type: "http", url: "https://mcp.figma.com/mcp" });
    // od - не npx: пресет не адаптируется под менеджер пакетов
    const openDesign = bun.find((p) => p.name === "open-design")!;
    expect(openDesign.transport).toEqual({
      type: "stdio",
      command: "od",
      args: ["mcp", "--daemon-url", "http://127.0.0.1:7456"],
    });
    const npm = mcpPresetsForPm("npm");
    const npmContext7 = npm.find((p) => p.name === "context7")!.transport;
    expect(npmContext7.type === "stdio" && npmContext7.command).toBe("npx");
  });

  test("globalInstallCommand", () => {
    expect(globalInstallCommand("bun", "x")).toEqual(["bun", "add", "-g", "x"]);
    expect(globalInstallCommand("npm", "x")).toEqual(["npm", "install", "-g", "x"]);
  });

  test("cleanupAfterUninstall (rtk project): маркерные блоки и файлы зачищаются", async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const tmp = await mkdtemp(join(tmpdir(), "rtk-cleanup-"));
    try {
      await writeFile(
        join(tmp, "CLAUDE.md"),
        "до\n<!-- rtk-instructions v2 -->\n# RTK\nинструкции\n<!-- /rtk-instructions -->\nпосле\n",
        "utf8",
      );
      await mkdir(join(tmp, ".rtk"), { recursive: true });
      await writeFile(join(tmp, ".rtk", "filters.toml"), "x", "utf8");
      const { cleanupAfterUninstall } = await import("@/core/toolActions");
      const cleaned = await cleanupAfterUninstall(tmp, toolById("rtk")!, params({ scope: "project" }));
      expect(cleaned.some((c) => c.includes("CLAUDE.md"))).toBe(true);
      expect(cleaned.some((c) => c.includes("filters.toml"))).toBe(true);
      const md = await readFile(join(tmp, "CLAUDE.md"), "utf8");
      expect(md).toBe("до\nпосле\n");
      await expect(readFile(join(tmp, ".rtk", "filters.toml"), "utf8")).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("состояние инструмента", () => {
  const repoRoot = "/repo";
  const home = "/home/u";

  test("запись консоли определяет on/off", () => {
    const state = defaultState(repoRoot);
    state.tools.installed["graphify"] = { runtimes: ["claude"], params: params(), at: "", enabled: true };
    expect(effectiveToolState(toolById("graphify")!, state, home, repoRoot)).toBe("on");
    state.tools.installed["graphify"]!.enabled = false;
    expect(effectiveToolState(toolById("graphify")!, state, home, repoRoot)).toBe("off");
  });

  test("без записи - MCP-реестр (serena), иначе missing", () => {
    const state = defaultState(repoRoot);
    expect(effectiveToolState(toolById("serena")!, state, home, repoRoot)).toBe("missing");
    state.mcp.servers["serena"] = {
      name: "serena",
      transport: { type: "stdio", command: "serena" },
      enabled: true,
    };
    expect(effectiveToolState(toolById("serena")!, state, home, repoRoot)).toBe("on");
    state.mcp.servers["serena"]!.enabled = false;
    expect(effectiveToolState(toolById("serena")!, state, home, repoRoot)).toBe("off");
  });

  test("per-runtime детект по маркеру graphify (claude - home, cursor - проект)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tools-marker-"));
    const fakeHome = join(tmp, "home");
    try {
      const state = defaultState(tmp);
      const def = toolById("graphify")!;
      state.tools.installed["graphify"] = { runtimes: [], params: params(), at: "", enabled: false };
      // маркеров ещё нет - детект по записи не срабатывает (runtimes пуст)
      expect(toolRuntimeInstalled(def, "claude", fakeHome, tmp, state)).toBe(false);
      // маркер claude - ~/.claude/skills/graphify/SKILL.md
      await mkdir(join(fakeHome, ".claude", "skills", "graphify"), { recursive: true });
      await writeFile(join(fakeHome, ".claude", "skills", "graphify", "SKILL.md"), "x", "utf8");
      expect(toolRuntimeInstalled(def, "claude", fakeHome, tmp, state)).toBe(true);
      // маркер cursor - файл <repoRoot>/.cursor/rules/graphify.mdc
      expect(toolRuntimeInstalled(def, "cursor", fakeHome, tmp, state)).toBe(false);
      await mkdir(join(tmp, ".cursor", "rules"), { recursive: true });
      await writeFile(join(tmp, ".cursor", "rules", "graphify.mdc"), "x", "utf8");
      expect(toolRuntimeInstalled(def, "cursor", fakeHome, tmp, state)).toBe(true);
      // маркеры - project|home: codex виден по проектному пути (без ~)
      await mkdir(join(tmp, ".codex", "skills", "graphify"), { recursive: true });
      await writeFile(join(tmp, ".codex", "skills", "graphify", "SKILL.md"), "x", "utf8");
      expect(toolRuntimeInstalled(def, "codex", fakeHome, tmp, state)).toBe(true);
      // запись есть и выключена - эффективное состояние off (не on от маркеров)
      expect(effectiveToolState(def, state, fakeHome, tmp)).toBe("off");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("tools.env и package-manager.json", () => {
  test("writeToolsEnv: on/off строки, missing и openwiki не пишутся", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tools-env-"));
    try {
      const state = defaultState(tmp);
      state.tools.installed["graphify"] = { runtimes: ["claude"], params: params(), at: "", enabled: true };
      state.tools.installed["rtk"] = { runtimes: ["claude"], params: params(), at: "", enabled: false };
      await writeToolsEnv(tmp, state);
      const text = await readFile(join(tmp, ".agents", "console", "tools.env"), "utf8");
      expect(text).toContain("TOOL_GRAPHIFY=on");
      expect(text).toContain("TOOL_RTK=off");
      expect(text).not.toContain("TOOL_QMD=");
      expect(text).not.toContain("TOOL_OPENWIKI");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("package-manager.json: roundtrip, default bun, npm распознаётся", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tools-pm-"));
    try {
      expect(await readPackageManagerPref(tmp)).toBe("bun");
      await writePackageManagerPref(tmp, "npm");
      expect(await readPackageManagerPref(tmp)).toBe("npm");
      await writeFile(join(tmp, ".agents", "console", "package-manager.json"), "{ не json", "utf8");
      expect(await readPackageManagerPref(tmp)).toBe("bun");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
