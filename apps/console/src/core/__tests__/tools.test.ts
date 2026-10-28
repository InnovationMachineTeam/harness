import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "@/core/state";
import {
  TOOLS,
  TOOL_COMBOS,
  comboById,
  effectiveToolState,
  globalInstallCommand,
  readPackageManagerPref,
  toolById,
  toolRuntimeInstalled,
  writePackageManagerPref,
  writeToolsEnv,
} from "@/core/tools";
import { buildComboInstallSteps, buildUpdateSteps } from "@/core/toolActions";
import { lightragLlmConfig, lightragLlmEnv, lightragServiceEnv } from "@/core/lightragLlm";
import { mcpPresetsForPm } from "@/core/plugins";
import { sanitizeToolParams } from "@/core/toolActions";
import type { ToolInstallParams } from "@/core/state";

const params = (p: Partial<ToolInstallParams> = {}): ToolInstallParams => ({
  scope: "global",
  mode: "wrap",
  ...p,
});

describe("реестр инструментов", () => {
  test("16 инструментов с уникальными id и бинарями", () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual(
      [
        "agentplane",
        "codeburn",
        "codegraph",
        "graphify",
        "headroom",
        "lightrag",
        "neo4j",
        "nx",
        "open-design",
        "openbot",
        "openwiki",
        "qdrant",
        "qmd",
        "rea",
        "rtk",
        "serena",
      ].sort(),
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

  test("rea: npm-глобальная установка, MCP stdio и компактный профиль ответов", () => {
    const def = toolById("rea")!;
    expect(def.bin).toBe("rea");
    expect(def.category).toBe("code");
    expect(def.systemInstall("bun", "darwin")).toEqual(["bun", "add", "-g", "rea-agents"]);
    expect(def.systemInstall("npm", "linux")).toEqual(["npm", "install", "-g", "rea-agents"]);
    expect(def.systemUpdate?.("bun", "darwin")).toEqual(["bun", "add", "-g", "rea-agents@latest"]);
    expect(def.mcpPreset?.(params())).toEqual({ type: "stdio", command: "rea", args: ["mcp"] });
    expect(def.mcpPreset?.(params({ compactMcpOutput: true }))).toEqual({
      type: "stdio",
      command: "rea",
      args: ["mcp"],
      env: { REA_MCP_OUTPUT_SCHEMA_PROFILE: "compact" },
    });
    expect(def.perRuntime?.supported).toEqual([]); // MCP расходится через managed sync
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
    expect(deepwiki.transport).toEqual({ type: "http", url: "https://mcp.deepwiki.com/mcp" });
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

  test("связки памяти: id, члены существуют, описание заполнено", () => {
    expect(TOOL_COMBOS.map((c) => c.id)).toEqual(["neo4j-lightrag", "neo4j-qdrant"]);
    for (const combo of TOOL_COMBOS) {
      expect(combo.description.length).toBeGreaterThan(0);
      for (const toolId of combo.toolIds) {
        expect(toolById(toolId)).toBeDefined();
      }
    }
    expect(comboById("neo4j-lightrag")?.toolIds).toEqual(["neo4j", "lightrag"]);
    expect(comboById("нет-такой")).toBeUndefined();
  });

  test("neo4j: brew на darwin, MCP mcp-neo4j-memory c env, пароль задаётся после установки", () => {
    const def = toolById("neo4j")!;
    expect(def.category).toBe("memory");
    expect(def.systemInstall("bun", "darwin")).toEqual(["brew", "install", "neo4j"]);
    expect(def.systemInstall("bun", "linux")).toBeNull();
    expect(def.uninstallStopsDashboard).toBe(true);
    expect(def.mcpPreset?.(params())).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["mcp-neo4j-memory", "--transport", "stdio"],
      env: { NEO4J_URI: "bolt://localhost:7687", NEO4J_USERNAME: "neo4j", NEO4J_PASSWORD: "harness-memory" },
    });
    const post = def.postInstallCommands!(defaultState("/repo"), params());
    for (const command of post) {
      expect(command[0]).toBe("neo4j-admin");
    }
  });

  test("lightrag: uv-пакет lightrag-hku[api,offline-llm,offline-storage], CLI lightrag-server, без MCP", () => {
    const def = toolById("lightrag")!;
    expect(def.bin).toBe("lightrag-server");
    expect(def.systemInstall("bun", "darwin")).toEqual(["uv", "tool", "install", "lightrag-hku[api,offline-llm,offline-storage]"]);
    expect(def.mcpPreset).toBeUndefined();
    expect(def.uninstallStopsDashboard).toBe(true);
    expect(def.requires?.bin).toBe("uv");
  });

  test("qdrant: релиз GitHub на darwin (mkdir), MCP mcp-server-qdrant с QDRANT_URL и коллекцией", () => {
    const def = toolById("qdrant")!;
    expect(def.category).toBe("memory");
    expect(def.systemInstall("bun", "darwin")?.[0]).toBe("mkdir");
    expect(def.systemInstall("bun", "linux")).toBeNull();
    // postInstall: до установки - скачивание релиза; после - пусто
    const post = def.postInstallCommands!(defaultState("/repo"), params());
    for (const command of post) {
      expect(["curl", "tar", "ln"]).toContain(command[0]);
    }
    expect(def.mcpPreset?.(params())).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-qdrant"],
      env: { QDRANT_URL: "http://127.0.0.1:6333", COLLECTION_NAME: "harness-memory" },
    });
  });

  test("openbot: категория agents, зависимость docker, клон в postInstall, дашборд :3010", () => {
    const def = toolById("openbot")!;
    expect(def.category).toBe("agents");
    expect(def.bin).toBe("docker");
    expect(def.requires?.bin).toBe("docker");
    expect(def.requires?.installCommand("darwin")).toBeNull();
    expect(def.systemInstall("bun", "darwin")).toBeNull();
    expect(def.mcpPreset).toBeUndefined();
    expect(def.dashboard).toEqual({ url: "http://127.0.0.1:3010", label: "OpenBot" });
    expect(def.uninstallStopsDashboard).toBe(true);
    // обновление - git pull каталога клонирования; без каталога шаг не строится
    const update = def.systemUpdate?.("bun", "darwin");
    if (update) expect(update.slice(0, 2)).toEqual(["git", "-C"]);
    else expect(update).toBeNull();
  });

  test("lightragLlm: env биндинга по пресетам, сервисный env содержит Neo4j-хранилище", () => {
    const state = defaultState("/repo");
    // по умолчанию - локальный Ollama
    expect(lightragLlmConfig(state).preset).toBe("ollama");
    expect(lightragLlmEnv(lightragLlmConfig(state))).toEqual({
      LLM_BINDING: "ollama",
      EMBEDDING_BINDING: "ollama",
      LLM_BINDING_HOST: "http://localhost:11434",
      EMBEDDING_BINDING_HOST: "http://localhost:11434",
    });
    state.lightragLlm = { preset: "openai", apiKey: "sk-test", baseUrl: "", modelId: "gpt-4o-mini" };
    const openai = lightragLlmEnv(lightragLlmConfig(state));
    expect(openai.LLM_BINDING).toBe("openai");
    expect(openai.LLM_BINDING_API_KEY).toBe("sk-test");
    expect(openai.LLM_MODEL).toBe("gpt-4o-mini");
    expect(openai.LLM_BINDING_HOST).toBeUndefined();
    const service = lightragServiceEnv(state);
    expect(service.LIGHTRAG_GRAPH_STORAGE).toBe("Neo4JStorage");
    expect(service.NEO4J_URI).toBe("bolt://localhost:7687");
    expect(service.NEO4J_PASSWORD).toBe("harness-memory");
  });

  test("buildComboInstallSteps: неизвестный член - ошибка; шаги получают префикс инструмента", () => {
    const bad = buildComboInstallSteps({
      combo: { id: "x", title: "X", description: "", toolIds: ["neo4j", "нет-такого"] },
      params: params(),
      platform: "darwin",
      packageManager: "bun",
      state: defaultState("/repo"),
      repoRoot: "/repo",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("нет-такого");
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

describe("обновление системного пакета", () => {
  test("uv-инструменты обновляются через uv tool upgrade по имени пакета", () => {
    expect(toolById("serena")?.systemUpdate?.("bun", "darwin")).toEqual(["uv", "tool", "upgrade", "serena-agent"]);
    expect(toolById("headroom")?.systemUpdate?.("bun", "darwin")).toEqual(["uv", "tool", "upgrade", "headroom-ai"]);
    expect(toolById("lightrag")?.systemUpdate?.("bun", "darwin")).toEqual(["uv", "tool", "upgrade", "lightrag-hku"]);
  });

  test("npm-инструменты: спек @latest выбранным менеджером", () => {
    expect(toolById("agentplane")?.systemUpdate?.("bun", "darwin")).toEqual(["bun", "add", "-g", "agentplane@latest"]);
    expect(toolById("agentplane")?.systemUpdate?.("npm", "linux")).toEqual(["npm", "install", "-g", "agentplane@latest"]);
  });

  test("brew-инструменты: brew upgrade на darwin и отсутствие команды на других ОС", () => {
    expect(toolById("rtk")?.systemUpdate?.("bun", "darwin")).toEqual(["brew", "upgrade", "rtk"]);
    expect(toolById("neo4j")?.systemUpdate?.("bun", "linux")).toBeNull();
  });

  test("инструменты с ручным обновлением без systemUpdate", () => {
    expect(toolById("qdrant")?.systemUpdate).toBeUndefined();
    expect(toolById("open-design")?.systemUpdate).toBeUndefined();
  });

  test("buildUpdateSteps: шаг с командой, у ручных инструментов - пусто", () => {
    const serena = toolById("serena")!;
    expect(buildUpdateSteps(serena, "darwin", "bun")).toEqual([
      { label: "Обновление: Serena", command: ["uv", "tool", "upgrade", "serena-agent"] },
    ]);
    const qdrant = toolById("qdrant")!;
    expect(buildUpdateSteps(qdrant, "darwin", "bun")).toEqual([]);
  });

  test("все uv- и brew-инструменты имеют systemUpdate (синхронно с core/updates.ts)", () => {
    for (const id of ["serena", "headroom", "graphify", "lightrag"]) {
      expect(toolById(id)?.systemUpdate, id).toBeDefined();
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
