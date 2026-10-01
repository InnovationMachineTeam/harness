import path from "node:path";
import type { ToolDef, ToolRuntimeId } from "../tools";

/** Плагин инструмента RTK: сжатие вывода shell-команд через хуки. */
export const rtkTool: ToolDef = {
  id: "rtk",
  title: "RTK",
  description:
    "Сжатие вывода shell-команд (git/test/lint, заявлено 60-90%) через PreToolUse-хуки рантаймов; также префикс rtk для шумных команд.",
  docsUrl: "https://github.com/rtk-ai/rtk",
  category: "context",
  bin: "rtk",
  systemInstall: (_pm, platform) => (platform === "darwin" ? ["brew", "install", "rtk"] : null),
  perRuntime: {
    // Матрица по `rtk init --help` (0.39.x): в --agent нет codex (и zcode);
    // opencode - отдельный флаг --opencode (плагин в дополнение к Claude);
    // kimi - всегда project-scoped (без -g, правила в AGENTS.md репозитория).
    // scope=project ставит остальные рантаймы тоже в проектные файлы (без -g).
    supported: ["claude", "cursor", "opencode", "kimi"],
    notes: {
      codex: "RTK 0.39.x не интегрирует Codex CLI (в rtk init нет --codex); префикс rtk <cmd> работает и без хука",
      zcode: "RTK не поддерживает ZCode (rtk-ai/rtk#2898); префикс rtk <cmd> работает и без хука",
      kimi: "Всегда project-scoped: правила пишутся в AGENTS.md репозитория (для другого проекта запустите установку там же)",
    },
    params: [{ key: "scope", label: "Область хуков/правил", hint: "global: конфиги в ~, project: в репозитории" }],
    installCommand: (runtime, params) => {
      const global = params.scope !== "project" && runtime !== "kimi";
      const g = global ? ["-g"] : [];
      // --auto-patch (claude): неинтерактивный патч settings.json хуком (в job нет TTY)
      if (runtime === "claude") return ["rtk", "init", ...g, "--auto-patch"];
      if (runtime === "opencode") return ["rtk", "init", ...g, "--opencode"];
      return ["rtk", "init", ...g, "--agent", runtime];
    },
    uninstallCommand: (runtime) => {
      // --uninstall у rtk работает только с -g (для любых агентов);
      // project-снятие - программная зачистка в cleanupAfterUninstall
      if (runtime === "claude") return ["rtk", "init", "--uninstall", "-g"];
      if (runtime === "opencode") return ["rtk", "init", "--uninstall", "-g", "--opencode"];
      return ["rtk", "init", "--uninstall", "-g", "--agent", runtime];
    },
    markerFile: (runtime, home, repoRoot) => {
      const p: Partial<Record<ToolRuntimeId, string[]>> = {
        claude: [path.join(home, ".claude", "RTK.md"), path.join(repoRoot, ".claude", "RTK.md")],
        opencode: [
          path.join(home, ".config", "opencode", "plugins", "rtk.ts"),
          path.join(repoRoot, ".opencode", "plugins", "rtk.ts"),
        ],
      };
      return p[runtime] ?? null;
    },
  },
};
