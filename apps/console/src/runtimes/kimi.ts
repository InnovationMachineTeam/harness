import { join } from "node:path";
import type { ActivitySignal, Issue, ProbeContext, RuntimeAdapter, SessionDetail, SessionSummary, SkillItem } from "@/core/types";
import { hookFileIssue } from "@/core/issues";
import { getKimiSession, listKimiSessions } from "@/core/sessions/kimi";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";

/** Kimi Code: история пользовательских вводов и лог CLI. */
export const kimiAdapter: RuntimeAdapter = {
  id: "kimi",
  displayName: "Kimi Code",
  processPattern: /kimi-code|(^|[/\s])kimi(\s|$)/,
  isInstalled: (ctx) => anyExists([join(ctx.home, ".kimi-code")]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];

    const historyLatest = await ctx.fs.newestMtime(join(ctx.home, ".kimi-code", "user-history"), {
      match: (name) => name.endsWith(".jsonl"),
      maxDepth: 1,
    });
    if (historyLatest) {
      signals.push({
        at: historyLatest.at,
        scope: "machine",
        source: `~/.kimi-code/user-history/${historyLatest.source}`,
      });
    }

    const logMtime = await ctx.fs.mtimeOf(join(ctx.home, ".kimi-code", "logs", "kimi-code.log"));
    if (logMtime) {
      signals.push({ at: logMtime, scope: "machine", source: "~/.kimi-code/logs/kimi-code.log" });
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    // навыки Kimi задаются через extra_skill_dirs в config.toml (собственных каталогов нет)
    const config = await ctx.fs.readText(join(ctx.home, ".kimi-code", "config.toml"), 32_000);
    if (!config) return [];
    const dirs = [
      ...(config.match(/extra_skill_dirs\s*=\s*\[([^\]]*)\]/)?.[1].match(/"([^"]+)"/g) ?? []),
    ].map((s) => s.replace(/"/g, ""));
    const items: SkillItem[] = [];
    for (const dir of dirs) {
      const abs = dir.startsWith("/") ? dir : join(ctx.home, dir.replace(/^~\/?/, ""));
      const files = await ctx.fs.collectFiles(abs, {
        match: (name) => name === "SKILL.md",
        maxDepth: 2,
        limit: 50,
      });
      for (const f of files) {
        const relDir = `${dir}/${f.relPath.replace(/\/SKILL\.md$/, "")}`;
        const item = toSkillItem(ctx, "kimi", "skill", f.relPath.split("/")[0] ?? "skill", f.path, relDir);
        item.description = await skillDescription(ctx, f.path);
        items.push(item);
      }
    }
    return items;
  },

  async detectIssues(ctx: ProbeContext) {
    const issues: Issue[] = await hookFileIssue(
      (p, max) => ctx.fs.readText(p, max),
      join(ctx.repoRoot, ".kimi", "config.toml"),
      "kimi",
    );
    // проектных хуков нет: политика работает через зеркало в ~/.kimi-code/config.toml
    const mirror = await ctx.fs.readText(join(ctx.home, ".kimi-code", "config.toml"), 32_000);
    if (mirror === null) {
      issues.push({
        severity: "warn",
        title: "Зеркало ~/.kimi-code/config.toml не найдено",
        detail: "Проектных хуков у Kimi нет; блок [[hooks]] нужно скопировать в пользовательский config.toml",
        hint: "Скопируйте [[hooks]]-блок из .kimi/config.toml в ~/.kimi-code/config.toml (AGENTS.md §1)",
      });
    } else if (!mirror.includes("[[hooks]]")) {
      issues.push({
        severity: "warn",
        title: "В ~/.kimi-code/config.toml нет [[hooks]]",
        detail: "Guard-политика репозитория не применяется к Kimi Code",
        hint: "Добавьте [[hooks]]-блок из .kimi/config.toml в ~/.kimi-code/config.toml",
      });
    }
    return issues;
  },

  listSessions: (ctx, dirs) => listKimiSessions(ctx, dirs),
  getSession: (ctx, id) => getKimiSession(ctx, id),

  replyCommand: (sessionId, text) => ({ command: "kimi", args: ["--session", sessionId, "-p", text] }),
  runCommand: (text) => ({ command: "kimi", args: ["-p", text] }),
};
