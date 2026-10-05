import path from "node:path";
import { graphifyWorkspaceDir } from "../graphify";
import { globalInstallCommand, type ToolDef, type ToolRuntimeId } from "../tools";

/** Плагин инструмента Graphify: граф знаний кода и доков (skill/hooks). */
export const graphifyTool: ToolDef = {
  id: "graphify",
  title: "Graphify",
  description:
    "Граф знаний кода и доков: graphify query возвращает подграф вместо чтения файлов. Ставит skill/hooks в каждый рантайм; графы рабочих папок - в хранилище ./graphify/<имя>/graphify-out (вкладка \"Память\").",
  docsUrl: "https://github.com/safishamsi/graphify",
  category: "graph",
  bin: "graphify",
  systemInstall: () => ["uv", "tool", "install", "graphifyy"],
  requires: {
    bin: "uv",
    installCommand: (platform) => (platform === "darwin" ? ["brew", "install", "uv"] : null),
  },
  projectInit: {
    // граф каждой рабочей папки - в хранилище воркспейсов консоли
    // (<repoRoot>/graphify/<имя>/graphify-out), а не внутри папки.
    // --code-only: локальный AST без LLM-ключа (doc-файлы пропускаются;
    // полный режим с доками требует API-ключ - см. вывод graphify extract).
    // extract инкрементален (manifest-гейт), поэтому и update идёт через него:
    // `graphify update` пишет граф только внутри исходной папки.
    init: (dir, repoRoot, name) => [graphifyExtractCommand(dir, repoRoot, name)],
    reinit: (dir, repoRoot, name) => [graphifyExtractCommand(dir, repoRoot, name)],
    update: (dir, repoRoot, name) => [graphifyExtractCommand(dir, repoRoot, name)],
    initMarker: (dir, repoRoot, name) => path.join(graphifyWorkspaceDir(repoRoot, name), "graphify-out", "graph.json"),
  },
  perRuntime: {
    supported: ["claude", "codex", "cursor", "opencode", "kimi", "zcode"],
    notes: {
      zcode: "Generic-платформа agents: skill в ~/.agents/skills (при project-scope - ./.agents/skills)",
    },
    params: [
      { key: "scope", label: "Область skill/hooks", hint: "global: ~, project: репозиторий" },
      { key: "strict", label: "Strict (только Claude): блокировать первый \"сырой\" read сессии", runtimes: ["claude"] },
    ],
    installCommand: (runtime, params) => {
      const platform = graphifyPlatform[runtime] ?? "claude";
      return [
        "graphify",
        "install",
        "--platform",
        platform,
        ...(params.scope === "project" ? ["--project"] : []),
        ...(params.strict && runtime === "claude" ? ["--strict"] : []),
      ];
    },
    uninstallCommand: (runtime) => ["graphify", "uninstall", "--platform", graphifyPlatform[runtime] ?? "claude"],
    markerFile: (runtime, home, repoRoot) => {
      // интеграция бывает project- (в репозитории) и global- (в ~) - считаем
      // установленной, если найден любой из вариантов
      const p: Partial<Record<ToolRuntimeId, string[]>> = {
        claude: [
          path.join(repoRoot, ".claude", "skills", "graphify", "SKILL.md"),
          path.join(home, ".claude", "skills", "graphify", "SKILL.md"),
        ],
        codex: [
          path.join(repoRoot, ".codex", "skills", "graphify", "SKILL.md"),
          path.join(home, ".codex", "skills", "graphify", "SKILL.md"),
        ],
        // cursor: правило always-on пишется только в проект (project-scope)
        cursor: [path.join(repoRoot, ".cursor", "rules", "graphify.mdc")],
        opencode: [
          path.join(repoRoot, ".opencode", "skills", "graphify", "SKILL.md"),
          path.join(home, ".config", "opencode", "skills", "graphify", "SKILL.md"),
        ],
        kimi: [
          path.join(repoRoot, ".kimi", "skills", "graphify", "SKILL.md"),
          path.join(home, ".kimi", "skills", "graphify", "SKILL.md"),
        ],
        zcode: [
          path.join(repoRoot, ".agents", "skills", "graphify", "SKILL.md"),
          path.join(home, ".agents", "skills", "graphify", "SKILL.md"),
        ],
      };
      return p[runtime] ?? null;
    },
  },
};

/** Команда сборки графа папки в хранилище воркспейсов. */
function graphifyExtractCommand(dir: string, repoRoot: string, name: string): string[] {
  return ["graphify", "extract", dir, "--code-only", "--out", graphifyWorkspaceDir(repoRoot, name)];
}

/** Платформы graphify per runtime (zcode - generic agents). */
const graphifyPlatform: Partial<Record<ToolRuntimeId, string>> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
  kimi: "kimi",
  zcode: "agents",
};
