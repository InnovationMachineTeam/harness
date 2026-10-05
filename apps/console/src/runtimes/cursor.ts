import { join } from "node:path";
import type { ActivitySignal, Issue, ProbeContext, RuntimeAdapter, SkillItem } from "@/core/types";
import { hookFileIssue } from "@/core/issues";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";

/** Cursor: пер-project хранилища нет, история - в SQLite (не читаем). */
export const cursorAdapter: RuntimeAdapter = {
  id: "cursor",
  displayName: "Cursor",
  processPattern: /Cursor\.app/,
  isInstalled: (ctx) =>
    anyExists([join(ctx.home, ".cursor"), join(ctx.home, "Library", "Application Support", "Cursor")]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];

    const dbMtime = await ctx.fs.mtimeOf(
      join(ctx.home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
    );
    if (dbMtime) {
      signals.push({
        at: dbMtime,
        scope: "machine",
        source: "~/Library/Application Support/Cursor/…/state.vscdb",
      });
    }

    // ~/.cursor содержит extensions с сотнями файлов - ограничиваем обход
    const homeLatest = await ctx.fs.newestMtime(join(ctx.home, ".cursor"), { maxDepth: 2, scanLimit: 500 });
    if (homeLatest) {
      signals.push({ at: homeLatest.at, scope: "machine", source: `~/.cursor/${homeLatest.source}` });
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    const items: SkillItem[] = [];
    const seen = new Set<string>();
    // проектный каталог приоритетнее глобальных
    const roots = [
      { root: join(ctx.repoRoot, ".cursor", "skills"), label: "project" },
      { root: join(ctx.home, ".cursor", "skills-cursor"), label: "skills-cursor" },
      { root: join(ctx.home, ".cursor", "skills"), label: "skills" },
    ];
    for (const { root, label } of roots) {
      const files = await ctx.fs.collectFiles(root, {
        match: (name) => name === "SKILL.md",
        maxDepth: 2,
        limit: 100,
      });
      for (const f of files) {
        const name = f.relPath.replace(/\/SKILL\.md$/, "").split("/")[0] ?? "skill";
        if (seen.has(name)) continue;
        seen.add(name);
        const relDir = `${label}/${f.relPath.replace(/\/SKILL\.md$/, "")}`;
        const item = toSkillItem(ctx, "cursor", "skill", name, f.path, relDir);
        item.description = await skillDescription(ctx, f.path);
        items.push(item);
      }
    }
    return items;
  },

  async detectIssues(ctx: ProbeContext) {
    const issues: Issue[] = await hookFileIssue(
      (p, max) => ctx.fs.readText(p, max),
      join(ctx.repoRoot, ".cursor", "hooks.json"),
      "cursor",
    );
    // fail-open: упавший хук пропускает вызов - это ослабляет политику guard
    const text = await ctx.fs.readText(join(ctx.repoRoot, ".cursor", "hooks.json"), 8_000);
    if (text && !/"failClosed"\s*:\s*true/.test(text)) {
      issues.push({
        severity: "warn",
        title: "Хук Cursor настроен fail-open",
        detail: 'failClosed не true: упавший hook молча пропустит вызов - guard здесь слой поверх одобрений IDE, а не единственная защита',
        hint: "Осознанно принято в AGENTS.md §1; при сбое хука политика соблюдается поведенчески",
      });
    }
    return issues;
  },

  // история сессий Cursor - в state.vscdb (SQLite): списки и ответы не поддерживаются
};
