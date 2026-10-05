import { join } from "node:path";
import type { ActivitySignal, FileEntry, Issue, ProbeContext, RuntimeAdapter, SessionDetail, SessionSummary, SkillItem } from "@/core/types";
import { hookFileIssue } from "@/core/issues";
import { codexAwaiting, getCodexSession, listCodexSessions } from "@/core/sessions/codex";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";
import { scanProcessesSync } from "@/lib/signals/processes";

/** Сколько новейших rollout-файлов просматриваем в поисках cwd этого репо. */
const CWD_PEEK_LIMIT = 40;

export const codexAdapter: RuntimeAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  processPattern: /codex/i,
  isInstalled: (ctx) => anyExists([join(ctx.home, ".codex")]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];
    const roots = [
      { dir: join(ctx.home, ".codex", "sessions"), label: "~/.codex/sessions" },
      { dir: join(ctx.home, ".codex", "archived_sessions"), label: "~/.codex/archived_sessions" },
    ];

    const rollouts: (FileEntry & { label: string })[] = [];
    for (const root of roots) {
      const files = await ctx.fs.collectFiles(root.dir, {
        match: (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
        maxDepth: 5,
        limit: 200,
      });
      rollouts.push(...files.map((f) => ({ ...f, label: root.label })));
    }
    rollouts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    if (rollouts.length === 0) return signals;

    signals.push({ at: rollouts[0].mtime, scope: "machine", source: `${rollouts[0].label}/${rollouts[0].relPath}` });

    for (const f of rollouts.slice(0, CWD_PEEK_LIMIT)) {
      const head = await ctx.fs.headJsonLine(f.path);
      const cwd = typeof head?.cwd === "string" ? head.cwd : null;
      if (cwd === ctx.repoRoot) {
        signals.push({ at: f.mtime, scope: "repo", source: `${f.label}/${f.relPath}` });
        break;
      }
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    const items: SkillItem[] = [];
    const seen = new Set<string>();
    // проектный каталог приоритетнее глобального
    for (const root of [join(ctx.repoRoot, ".codex", "skills"), join(ctx.home, ".codex", "skills")]) {
      const skills = await ctx.fs.collectFiles(root, {
        match: (name) => name === "SKILL.md",
        maxDepth: 2,
        limit: 100,
      });
      for (const f of skills) {
        const relDir = f.relPath.replace(/\/SKILL\.md$/, "");
        const name = relDir.split("/").pop() ?? "skill";
        if (seen.has(name)) continue;
        seen.add(name);
        const item = toSkillItem(ctx, "codex", "skill", name, f.path, relDir);
        item.description = await skillDescription(ctx, f.path);
        items.push(item);
      }
    }
    const prompts = await ctx.fs.collectFiles(join(ctx.home, ".codex", "prompts"), {
      match: (name) => name.endsWith(".md"),
      maxDepth: 1,
      limit: 100,
    });
    for (const f of prompts) {
      const name = f.name.replace(/\.md$/, "");
      if (seen.has(name)) continue;
      seen.add(name);
      const item = toSkillItem(ctx, "codex", "script", name, f.path, `prompts/${f.name}`);
      item.description = await skillDescription(ctx, f.path);
      items.push(item);
    }
    return items;
  },

  async detectIssues(ctx: ProbeContext) {
    const issues: Issue[] = await hookFileIssue(
      (p, max) => ctx.fs.readText(p, max),
      join(ctx.repoRoot, ".codex", "hooks.json"),
      "codex",
    );
    issues.push({
      severity: "info",
      title: "Хуки Codex грузятся после доверия слою .codex/",
      hint: "Проверьте загрузку командой /hooks в Codex CLI при первом запуске в репозитории",
    });
    return issues;
  },

  async awaitingInput(ctx: ProbeContext) {
    if (scanProcessesSync(/codex/i).length === 0) return null;
    return codexAwaiting(ctx);
  },

  listSessions: (ctx, dirs) => listCodexSessions(ctx, dirs),
  getSession: (ctx, id) => getCodexSession(ctx, id),

  replyCommand: (sessionId, text) => ({ command: "codex", args: ["exec", "resume", sessionId, text] }),
  runCommand: (text) => ({ command: "codex", args: ["exec", text] }),
};
