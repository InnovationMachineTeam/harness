import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { globalInstallCommand, type ToolDef } from "../tools";

// Обёртка C-4: init и index не открывают базу при живом writer.pid.
// Путь вычисляется лениво: import.meta.dir существует только в Bun (тесты,
// прямой запуск) и отсутствует в Node - модульный путь ломает next build.
// В собранной консоли база - cwd (apps/console при bun run start или корень
// репозитория); на этапе сборке путь не вычисляется.
let wrapperPath: string | null = null;
function codegraphWrapper(): string {
  if (wrapperPath) return wrapperPath;
  const meta = import.meta as { dir?: string };
  const candidates = meta.dir
    ? [resolve(meta.dir, "..", "..", "..", "..", "..", "tooling", "mcp", "codegraph.ts")]
    : [
        resolve(process.cwd(), "..", "..", "tooling", "mcp", "codegraph.ts"),
        resolve(process.cwd(), "tooling", "mcp", "codegraph.ts"),
      ];
  wrapperPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
  return wrapperPath;
}

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
    // быстрый догон (для git hooks). init/index идут через обёртку
    // tooling/mcp/codegraph.ts - база не открывается при живом writer.pid
    init: (dir) => [["bun", codegraphWrapper(), "init"]],
    reinit: (dir) => [["bun", codegraphWrapper(), "index"]],
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
