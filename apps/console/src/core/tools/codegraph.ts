import { globalInstallCommand, type ToolDef } from "../tools";

/** Плагин инструмента CodeGraph: knowledge graph кода в SQLite. */
export const codegraphTool: ToolDef = {
  id: "codegraph",
  title: "CodeGraph",
  description:
    "Knowledge graph кода в SQLite: один codegraph_explore вместо цепочек grep/Read (заявлено −62% токенов). MCP + per-runtime конфиги.",
  docsUrl: "https://github.com/colbymchenry/codegraph",
  category: "code",
  bin: "codegraph",
  systemInstall: (pm) => globalInstallCommand(pm, "@colbymchenry/codegraph"),
  mcpPreset: () => ({ type: "stdio", command: "codegraph", args: ["serve", "--mcp"] }),
  projectInit: {
    // init строит начальный индекс; index - полная пересборка; sync -q -
    // быстрый догон (для git hooks)
    init: (dir) => [["codegraph", "init"]],
    reinit: (dir) => [["codegraph", "index"]],
    update: (dir) => [["codegraph", "sync", "-q"]],
    initMarker: (dir) => `${dir}/.codegraph/codegraph.db`,
  },
  perRuntime: {
    supported: ["claude", "cursor", "codex", "opencode"],
    notes: {
      kimi: "CodeGraph не поддерживает Kimi Code - MCP доступен через проектный .mcp.json",
      zcode: "CodeGraph не поддерживает ZCode - MCP доступен через проектный .mcp.json",
    },
    params: [{ key: "scope", label: "Область конфигов MCP", hint: "global: ~, project: репозиторий" }],
    installCommand: (runtime, params) => [
      "codegraph",
      "install",
      "-t",
      runtime,
      "-l",
      params.scope === "project" ? "local" : "global",
      "-y",
    ],
    uninstallCommand: (runtime) => ["codegraph", "uninstall", "-t", runtime],
  },
};
