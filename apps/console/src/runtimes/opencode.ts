import { join } from "node:path";
import type { ActivitySignal, Issue, ProbeContext, RuntimeAdapter, SkillItem } from "@/core/types";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";

/** OpenCode: локальная БД сессий (SQLite) - mtime как маркер использования. */
export const opencodeAdapter: RuntimeAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  processPattern: /opencode/,
  isInstalled: (ctx) =>
    anyExists([join(ctx.home, ".config", "opencode"), join(ctx.home, ".local", "share", "opencode")]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];

    const dataDir = join(ctx.home, ".local", "share", "opencode");
    for (const name of ["opencode.db-wal", "opencode.db"]) {
      const mtime = await ctx.fs.mtimeOf(join(dataDir, name));
      if (mtime) {
        signals.push({ at: mtime, scope: "machine", source: `~/.local/share/opencode/${name}` });
      }
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    const items: SkillItem[] = [];

    // пользовательские агенты: ~/.config/opencode/agents/*.md
    const agents = await ctx.fs.collectFiles(join(ctx.home, ".config", "opencode", "agents"), {
      match: (name) => name.endsWith(".md"),
      maxDepth: 1,
      limit: 100,
    });
    for (const f of agents) {
      const name = f.name.replace(/\.md$/, "");
      const item = toSkillItem(ctx, "opencode", "agent", name, f.path, `agents/${f.name}`);
      item.description = await skillDescription(ctx, f.path);
      items.push(item);
    }

    // проектные скрипты-плагины репозитория: .opencode/plugins/*.ts
    const plugins = await ctx.fs.collectFiles(join(ctx.repoRoot, ".opencode", "plugins"), {
      match: (name) => name.endsWith(".ts"),
      maxDepth: 1,
      limit: 50,
    });
    for (const f of plugins) {
      const name = f.name.replace(/\.ts$/, "");
      const item = toSkillItem(ctx, "opencode", "script", name, f.path, `plugins/${f.name}`);
      items.push(item);
    }
    return items;
  },

  async detectIssues(ctx: ProbeContext) {
    const issues: Issue[] = [];
    const projectConfig = await ctx.fs.readText(join(ctx.repoRoot, "opencode.json"), 8_000);
    if (projectConfig === null) {
      issues.push({
        severity: "error",
        title: "Нет opencode.json в корне репозитория",
        hint: "OpenCode не увидит AGENTS.md и плагин guard",
      });
    }
    const plugin = await ctx.fs.readText(
      join(ctx.repoRoot, ".opencode", "plugins", "agentos-guard.ts"),
      16_000,
    );
    if (plugin === null) {
      issues.push({
        severity: "error",
        title: "Плагин .opencode/plugins/agentos-guard.ts не найден",
        hint: "Guard-политика не применяется к OpenCode",
      });
    } else if (!plugin.includes("guard.mjs") || !(plugin.includes("AGENT_RUNTIME") && plugin.includes("opencode"))) {
      issues.push({
        severity: "warn",
        title: "Плагин OpenCode не ведёт в guard с AGENT_RUNTIME=opencode",
      });
    }
    return issues;
  },

  // история сессий OpenCode - в opencode.db (SQLite): списки не поддерживаются

  replyCommand: (sessionId, text) => ({ command: "opencode", args: ["run", "-s", sessionId, text] }),
  runCommand: (text) => ({ command: "opencode", args: ["run", text] }),
};
