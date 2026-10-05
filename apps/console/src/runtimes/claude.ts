import { join } from "node:path";
import type { ActivitySignal, Issue, ProbeContext, RuntimeAdapter, SessionDetail, SessionSummary, SkillItem } from "@/core/types";
import { hookFileIssue } from "@/core/issues";
import { claudeAwaiting, getClaudeSession, listClaudeSessions } from "@/core/sessions/claude";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";
import { scanProcessesSync } from "@/lib/signals/processes";

/** Claude Code хранит сессии проекта в ~/.claude/projects/<путь-с-дефисами>/. */
function claudeProjectSlug(repoRoot: string): string {
  return repoRoot.replace(/\/+$/, "").replaceAll("/", "-");
}

export const claudeAdapter: RuntimeAdapter = {
  id: "claude",
  displayName: "Claude Code",
  processPattern: /Claude\.app|(^|[/\s])claude(\s|$)/,
  isInstalled: (ctx) => anyExists([join(ctx.home, ".claude")]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];

    const projectDir = join(ctx.home, ".claude", "projects", claudeProjectSlug(ctx.repoRoot));
    const repoLatest = await ctx.fs.newestMtime(projectDir, {
      match: (name) => name.endsWith(".jsonl"),
      maxDepth: 2,
    });
    if (repoLatest) {
      signals.push({
        at: repoLatest.at,
        scope: "repo",
        source: `~/.claude/projects/${claudeProjectSlug(ctx.repoRoot)}/${repoLatest.source}`,
      });
    }

    const histMtime = await ctx.fs.mtimeOf(join(ctx.home, ".claude", "history.jsonl"));
    if (histMtime) {
      signals.push({ at: histMtime, scope: "machine", source: "~/.claude/history.jsonl" });
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    // проектный каталог приоритетнее глобального: одноимённый навык из проекта
    // затеняет глобальный (тот же порядок, что у нативного разрешения Claude Code)
    const roots = [join(ctx.repoRoot, ".claude", "skills"), join(ctx.home, ".claude", "skills")];
    const items: SkillItem[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      const files = await ctx.fs.collectFiles(root, {
        match: (name) => name === "SKILL.md",
        maxDepth: 3,
        limit: 200,
      });
      for (const f of files) {
        const relDir = f.relPath.replace(/\/SKILL\.md$/, "");
        const name = relDir.split("/").pop() ?? "skill";
        if (seen.has(name)) continue;
        seen.add(name);
        const item = toSkillItem(ctx, "claude", "skill", name, f.path, relDir);
        item.description = await skillDescription(ctx, f.path);
        items.push(item);
      }
    }
    return items;
  },

  detectIssues: (ctx) =>
    hookFileIssue((p, max) => ctx.fs.readText(p, max), join(ctx.repoRoot, ".claude", "settings.json"), "claude"),

  async awaitingInput(ctx: ProbeContext) {
    if (scanProcessesSync(/Claude\.app|(^|[/\s])claude(\s|$)/).length === 0) return null;
    return claudeAwaiting(ctx);
  },

  listSessions: (ctx, dirs) => listClaudeSessions(ctx, dirs),
  getSession: (ctx, id) => getClaudeSession(ctx, id, ctx.workspaces),

  replyCommand: (sessionId, text) => ({ command: "claude", args: ["-p", "--resume", sessionId, text] }),
  runCommand: (text) => ({ command: "claude", args: ["-p", text] }),
  headlessJson: true,
};
