import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ActivitySignal, Issue, ProbeContext, RuntimeAdapter, SessionDetail, SessionSummary, SkillItem } from "@/core/types";
import { hookFileIssue } from "@/core/issues";
import { getZcodeSession, listZcodeSessions, zcodeAwaiting } from "@/core/sessions/zcode";
import { skillDescription, toSkillItem } from "@/core/skills";
import { anyExists } from "@/lib/signals/fs";
import { scanProcessesSync } from "@/lib/signals/processes";

const SESS_ID_RE = /(sess_[A-Za-z0-9-]+)/;

/** CLI ZCode: находится в бандле приложения; можно переопределить через ZCODE_CLI. */
export const ZCODE_CLI = process.env.ZCODE_CLI ?? "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";

/** Встроенный конфиг провайдера лежит в бандле приложения рядом с glm/, а не рядом с zcode.cjs. */
const ZCODE_APP_PROVIDER_CONFIG = resolve(dirname(ZCODE_CLI), "../config/provider/zcode-builtin.json");
const ZCODE_PERSONAL_PROVIDER_CONFIG = join(homedir(), ".zcode", "v2", "provider_config.json");

/**
 * GUI ZCode передаёт CLI пути конфигов провайдера через эти две переменные; без
 * них headless-CLI ищет встроенный конфиг рядом с zcode.cjs и завершается с
 * "无法定位 CLI ZCode Built-in Provider Config". CLI принимает пути только парой,
 * поэтому переменные выставляются, когда существуют оба файла.
 */
const ZCODE_RUN_ENV: Record<string, string> =
  existsSync(ZCODE_APP_PROVIDER_CONFIG) && existsSync(ZCODE_PERSONAL_PROVIDER_CONFIG)
    ? {
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ZCODE_APP_PROVIDER_CONFIG,
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: ZCODE_PERSONAL_PROVIDER_CONFIG,
      }
    : {};

export const zcodeAdapter: RuntimeAdapter = {
  id: "zcode",
  displayName: "ZCode",
  country: "cn",
  processPattern: /ZCode\.app|zcode-cli/,
  isInstalled: (ctx) => anyExists([join(ctx.home, ".zcode")]),

  async probeSignals(ctx: ProbeContext): Promise<ActivitySignal[]> {
    const signals: ActivitySignal[] = [];

    const plans = await ctx.fs.collectFiles(join(ctx.repoRoot, ".zcode", "plans"), {
      match: (name) => name.startsWith("plan-") && name.endsWith(".md"),
      maxDepth: 1,
      limit: 50,
    });
    if (plans[0]) {
      signals.push({ at: plans[0].mtime, scope: "repo", source: `.zcode/plans/${plans[0].relPath}` });
    }

    const rollouts = await ctx.fs.collectFiles(join(ctx.home, ".zcode", "cli", "rollout"), {
      match: (name) => name.endsWith(".jsonl"),
      maxDepth: 1,
      limit: 200,
    });
    if (rollouts.length === 0) return signals;

    const newest = rollouts[0];
    signals.push({ at: newest.mtime, scope: "machine", source: `~/.zcode/cli/rollout/${newest.relPath}` });

    const planSessions = new Set(
      plans.map((p) => p.name.match(SESS_ID_RE)?.[1]).filter((s): s is string => Boolean(s)),
    );
    const repoRollout = rollouts.find((r) => {
      const sess = r.name.match(SESS_ID_RE)?.[1];
      return sess !== undefined && planSessions.has(sess);
    });
    if (repoRollout) {
      signals.push({ at: repoRollout.mtime, scope: "repo", source: `~/.zcode/cli/rollout/${repoRollout.relPath}` });
    }
    return signals;
  },

  async listSkills(ctx: ProbeContext): Promise<SkillItem[]> {
    const items: SkillItem[] = [];
    const seen = new Set<string>();
    // проектный каталог: .zcode/skills/<skill>/SKILL.md - приоритетнее плагинов
    // (тот же порядок, что у нативного разрешения ZCode)
    const project = await ctx.fs.collectFiles(join(ctx.repoRoot, ".zcode", "skills"), {
      match: (name) => name === "SKILL.md",
      maxDepth: 2,
      limit: 200,
    });
    for (const f of project) {
      const name = f.relPath.replace(/\/SKILL\.md$/, "").split("/").pop() ?? "skill";
      if (seen.has(name)) continue;
      seen.add(name);
      const item = toSkillItem(ctx, "zcode", "skill", name, f.path, f.relPath.replace(/\/SKILL\.md$/, ""));
      item.description = await skillDescription(ctx, f.path);
      items.push(item);
    }
    // кэш плагинов: <marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md -
    // берём свежую версию каждого навыка плагина
    const cache = join(ctx.home, ".zcode", "cli", "plugins", "cache");
    const files = await ctx.fs.collectFiles(cache, {
      match: (name) => name === "SKILL.md",
      maxDepth: 6,
      limit: 400,
    });
    const byPluginSkill = new Map<string, { file: (typeof files)[number]; plugin: string; skill: string }>();
    for (const f of files) {
      const m = f.relPath.match(/^(?:[^/]+\/)?(?<plugin>[^/]+)\/[^/]+\/skills\/(?<skill>[^/]+)\/SKILL\.md$/);
      if (!m?.groups) continue;
      const key = `${m.groups.plugin}/${m.groups.skill}`;
      const prev = byPluginSkill.get(key);
      if (!prev || f.mtime > prev.file.mtime) {
        byPluginSkill.set(key, { file: f, plugin: m.groups.plugin, skill: m.groups.skill });
      }
    }
    for (const { file, plugin, skill } of byPluginSkill.values()) {
      if (seen.has(skill)) continue;
      seen.add(skill);
      const item = toSkillItem(ctx, "zcode", "skill", skill, file.path, `plugins/${plugin}/${skill}`);
      item.description = await skillDescription(ctx, file.path);
      items.push(item);
    }
    return items;
  },

  async detectIssues(ctx: ProbeContext) {
    const issues: Issue[] = await hookFileIssue(
      (p, max) => ctx.fs.readText(p, max),
      join(ctx.repoRoot, ".zcode", "config.json"),
      "zcode",
      { expectIncludes: ['"enabled": true'] },
    );
    return issues;
  },

  async awaitingInput(ctx: ProbeContext) {
    if (scanProcessesSync(/ZCode\.app|zcode-cli/).length === 0) return null;
    return zcodeAwaiting(ctx);
  },

  listSessions: (ctx) => listZcodeSessions(ctx),
  getSession: (ctx, id) => getZcodeSession(ctx, id),

  replyCommand: (sessionId, text) => ({ command: "node", args: [ZCODE_CLI, "-p", "--resume", sessionId, text] }),
  runCommand: (text) => ({ command: "node", args: [ZCODE_CLI, "-p", text] }),
  runEnv: ZCODE_RUN_ENV,
};
