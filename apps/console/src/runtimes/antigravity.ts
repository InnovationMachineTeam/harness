import { dirname, join } from "node:path";
import type { ActivitySignal, Issue, ProbeContext, RuntimeAdapter, SkillItem } from "@/core/types";
import { getAntigravitySession, listAntigravitySessions } from "@/core/sessions/antigravity";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";

/**
 * Antigravity (Google): guard-хук в .agents/hooks.json (контракт decision-JSON
 * переводит обёртка .guardrails/src/antigravity-hook.ts), навыки читаются нативно
 * из .agents/skills и ~/.gemini/config/skills, headless-запуск и resume - CLI agy.
 */
export const antigravityAdapter: RuntimeAdapter = {
  id: "antigravity",
  displayName: "Antigravity",
  country: "us",
  processPattern: /Antigravity\.app|antigravity-cli|\bagy\b/,
  isInstalled: (ctx) =>
    anyExists([
      join(ctx.home, ".gemini", "antigravity"),
      join(ctx.home, ".gemini", "antigravity-cli"),
      join(ctx.home, ".gemini", "config"),
      "/Applications/Antigravity.app",
    ]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];

    const historyMtime = await ctx.fs.mtimeOf(join(ctx.home, ".gemini", "antigravity-cli", "history.jsonl"));
    if (historyMtime) {
      signals.push({ at: historyMtime, scope: "machine", source: "~/.gemini/antigravity-cli/history.jsonl" });
    }
    const brainLatest = await ctx.fs.newestMtime(join(ctx.home, ".gemini", "antigravity", "brain"), { maxDepth: 2 });
    if (brainLatest) {
      signals.push({ at: brainLatest.at, scope: "machine", source: `~/.gemini/antigravity/brain/${brainLatest.source}` });
    }
    const convLatest = await ctx.fs.newestMtime(join(ctx.home, ".gemini", "antigravity", "conversations"), { maxDepth: 1 });
    if (convLatest) {
      signals.push({ at: convLatest.at, scope: "machine", source: `~/.gemini/antigravity/conversations/${convLatest.source}` });
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    // Antigravity читает каноническое хранилище .agents/skills воркспейса
    // и глобальный ~/.gemini/config/skills; поддерево master/ - внутренние
    // навыки harness со своим механизмом раскрытия
    const roots = [
      { dir: join(ctx.repoRoot, ".agents", "skills"), label: ".agents/skills" },
      { dir: join(ctx.home, ".gemini", "config", "skills"), label: "~/.gemini/config/skills" },
    ];
    const items: SkillItem[] = [];
    for (const root of roots) {
      const files = await ctx.fs.collectFiles(root.dir, {
        match: (name) => name === "SKILL.md",
        maxDepth: 2,
        limit: 60,
        exclude: (relPath) => relPath === "master" || relPath.startsWith("master/"),
      });
      for (const f of files) {
        if (await ctx.fs.exists(join(dirname(f.path), "manifest.yaml"))) continue;
        const relDir = f.relPath.replace(/\/SKILL\.md$/, "");
        const item = toSkillItem(ctx, "antigravity", "skill", relDir.split("/").pop() ?? "skill", f.path, `${root.label}/${relDir}`);
        item.description = await skillDescription(ctx, f.path);
        items.push(item);
      }
    }
    return items;
  },

  async detectIssues(ctx: ProbeContext): Promise<Issue[]> {
    // собственные проверки вместо hookFileIssue: хук ссылается на обёртку
    // antigravity-hook.ts, а не напрямую на .guardrails/src/cli.ts
    const file = join(ctx.repoRoot, ".agents", "hooks.json");
    const text = await ctx.fs.readText(file, 16_000);
    if (text === null) {
      return [
        {
          severity: "error",
          title: "Файл адаптера хуков не найден: .agents/hooks.json",
          hint: "Рантайм работает без guard-политики репозитория",
        },
      ];
    }
    const issues: Issue[] = [];
    if (!text.includes(".guardrails/src/antigravity-hook.ts")) {
      issues.push({
        severity: "error",
        title: "Хук не ведёт в guard: .agents/hooks.json",
        detail: "В файле адаптера нет ссылки на обёртку .guardrails/src/antigravity-hook.ts",
      });
    }
    if (!text.includes("AGENT_RUNTIME=antigravity")) {
      issues.push({
        severity: "warn",
        title: "Хук не задаёт AGENT_RUNTIME=antigravity",
        detail: "Guard не сможет загрузить конфиг этого рантайма",
      });
    }
    return issues;
  },

  listSessions: (ctx, dirs) => listAntigravitySessions(ctx, dirs),
  getSession: (ctx, id) => getAntigravitySession(ctx, id),

  replyCommand: (sessionId, text) => ({ command: "agy", args: ["-p", text, "--conversation", sessionId, "--output-format", "json"] }),
  runCommand: (text) => ({ command: "agy", args: ["-p", text, "--output-format", "json"] }),
  headlessJson: true,
};
