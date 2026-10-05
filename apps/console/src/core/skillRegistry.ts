import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadInternalSkills, loadWorkflowCatalog } from "./workflows/catalog";
import { collectHarnessSkills, skillDefault, skillEffective } from "./skills";
import type { ProbeContext, SkillItem } from "./types";
import { ADAPTERS } from "@/runtimes";

/**
 * Единый реестр навыков для вкладок "Навыки" (настройки и пространство
 * рантайма). Каждый навык имеет ровно один лейбл происхождения:
 * - internal: внутренние навыки мастер-каталога (manifest.yaml);
 * - skills.sh: публичные навыки .agents/skills из стандартного потока установки;
 * - plugin: имя числится в skills включённого установленного плагина;
 * - runtime: навык в собственных глобальных каталогах рантайма;
 * - workflow: определение workflow (управляется через workflow, без тоггла).
 * Бейджи рантаймов - где навык установлен (installed) и активен ли там
 * (effective - overlay тогглов state.skills).
 */

export type SkillLabel = "internal" | "design" | "runtime" | "skills.sh" | "plugin" | "workflow";

export interface UnifiedSkillRuntime {
  runtime: string;
  /** Навык доступен рантайму (привязка манифеста, симлинк или собственный каталог). */
  installed: boolean;
  /** Навык установлен и не выключен тогглом для этого рантайма. */
  effective: boolean;
}

export interface UnifiedSkill {
  key: string;
  name: string;
  label: SkillLabel;
  description: string;
  source: string;
  tags: string[];
  toggleable: boolean;
  /** Ключ в state.skills (defaults/runtimeOverrides). */
  itemId: string;
  /** Значение по умолчанию (уровень настроек) - база для тоггла без override. */
  defaultEnabled: boolean;
  runtimes: UnifiedSkillRuntime[];
  workflowId?: string;
  kind?: string;
  /** Хуки манифеста (только internal); исполнение - core/skillHooks.ts. */
  manifestHooks?: { install: string[]; remove: string[]; enable: string[]; disable: string[] };
  /** Абсолютный каталог навыка (internal и skills.sh) - цель симлинка хука. */
  sourceDir?: string;
}

/** Каталоги нативных навыков рантаймов в рабочей папке (симлинки хуков включения). */
export const RUNTIME_SKILL_DIRS: Record<string, string> = {
  claude: ".claude/skills",
  codex: ".codex/skills",
  cursor: ".cursor/skills",
  zcode: ".zcode/skills",
  opencode: ".opencode/skills",
};

const RUNTIME_IDS = Object.keys(ADAPTERS);

function readSkillsLock(repoRoot: string): Set<string> {
  try {
    const raw = readFileSync(path.join(repoRoot, "skills-lock.json"), "utf8");
    const parsed = JSON.parse(raw) as { skills?: Record<string, unknown> };
    return new Set(Object.keys(parsed.skills ?? {}));
  } catch {
    return new Set();
  }
}

type RegistryState = Parameters<typeof skillEffective>[0] & {
  plugins?: { installed?: Record<string, { enabled?: boolean; skills?: Array<{ name: string }> }> };
};

function pluginSkillNames(state: RegistryState): Set<string> {
  const out = new Set<string>();
  for (const plugin of Object.values(state.plugins?.installed ?? {})) {
    if (!plugin.enabled) continue;
    for (const skill of plugin.skills ?? []) {
      if (skill.name) out.add(skill.name);
    }
  }
  return out;
}

/** Симлинк навыка в нативном каталоге рантайма обязательной папки. */
export function runtimeSkillLinkPath(mandatoryWorkspace: string, runtime: string, name: string): string | null {
  const rel = RUNTIME_SKILL_DIRS[runtime];
  return rel ? path.join(mandatoryWorkspace, rel, name) : null;
}

export async function collectUnifiedSkills(ctx: ProbeContext, state: RegistryState): Promise<UnifiedSkill[]> {
  const items: UnifiedSkill[] = [];
  const runtimesOf = (installed: (runtime: string) => boolean, effective: (runtime: string, installedNow: boolean) => boolean): UnifiedSkillRuntime[] =>
    RUNTIME_IDS.map((runtime) => {
      const installedNow = installed(runtime);
      return { runtime, installed: installedNow, effective: effective(runtime, installedNow) };
    });

  /* internal: мастер-каталог и группа design */
  for (const entry of await loadInternalSkills(ctx.repoRoot)) {
    const group = entry.group ?? "master";
    const itemId = group + ":" + entry.value.id;
    items.push({
      key: itemId,
      name: entry.value.id,
      label: group === "design" ? "design" : "internal",
      description: entry.value.description,
      source: path.relative(ctx.repoRoot, entry.sourceFile),
      tags: entry.value.tags,
      toggleable: true,
      itemId,
      defaultEnabled: skillDefault(state, itemId),
      runtimes: runtimesOf(
        (runtime) => entry.value.runtimes.includes(runtime),
        (runtime, installedNow) => installedNow && skillEffective(state, itemId, runtime),
      ),
      manifestHooks: entry.value.hooks,
      sourceDir: path.dirname(entry.sourceFile),
    });
  }

  /* публичные: skills.sh / plugin */
  const lock = readSkillsLock(ctx.repoRoot);
  const pluginNames = pluginSkillNames(state);
  for (const item of await collectHarnessSkills(ctx)) {
    const name = item.name;
    items.push({
      key: item.id,
      name,
      label: pluginNames.has(name) ? "plugin" : "skills.sh",
      description: item.description ?? "",
      source: item.source,
      tags: [],
      toggleable: true,
      itemId: item.id,
      defaultEnabled: skillDefault(state, item.id),
      runtimes: runtimesOf(
        (runtime) => Boolean(runtimeSkillLinkPath(ctx.repoRoot, runtime, name) && existsSync(runtimeSkillLinkPath(ctx.repoRoot, runtime, name)!)),
        (runtime, installedNow) => installedNow && skillEffective(state, item.id, runtime),
      ),
      sourceDir: path.join(ctx.repoRoot, item.source),
    });
  }

  /* runtime: глобальные каталоги рантаймов */
  for (const runtime of RUNTIME_IDS) {
    const adapter = ADAPTERS[runtime];
    if (!adapter?.listSkills) continue;
    const list = await adapter.listSkills(ctx).catch(() => [] as SkillItem[]);
    for (const item of list) {
      if (item.kind !== "skill") continue;
      items.push({
        key: item.id,
        name: item.name,
        label: "runtime",
        description: item.description ?? "",
        source: item.source,
        tags: [],
        toggleable: true,
        itemId: item.id,
        defaultEnabled: skillDefault(state, item.id),
        runtimes: [{ runtime, installed: true, effective: skillEffective(state, item.id, runtime) }],
      });
    }
  }

  /* workflow */
  try {
    const catalog = await loadWorkflowCatalog(ctx.repoRoot, ctx.repoRoot);
    for (const [id, entry] of catalog) {
      items.push({
        key: "workflow:" + id,
        name: entry.value.title,
        label: "workflow",
        description: entry.value.nodes.length + " узл.",
        source: path.relative(ctx.repoRoot, entry.sourceFile),
        tags: [],
        toggleable: false,
        itemId: "workflow:" + id,
        defaultEnabled: false,
        runtimes: [],
        workflowId: id,
      });
    }
  } catch {
    /* каталог workflow недоступен - группа остаётся пустой */
  }

  return items;
}
