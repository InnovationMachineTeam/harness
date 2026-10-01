import { join } from "node:path";
import type { ConsoleState } from "./state";
import type { FileEntry, ProbeContext, SkillItem } from "./types";

/**
 * Оверлеи навыков: тогглы хранятся только в состоянии консоли -
 * файлы рантаймов никогда не изменяются и не удаляются.
 *
 * effective(item, runtime) = runtimeOverrides[item.id]?.[runtime]
 *                          ?? defaults[item.id]        (per-skill значение по умолчанию)
 *                          ?? useGlobal                (глобальный toggle)
 */

export function skillEffective(state: ConsoleState, itemId: string, runtime: string): boolean {
  const override = state.skills.runtimeOverrides[itemId]?.[runtime];
  if (typeof override === "boolean") return override;
  return skillDefault(state, itemId);
}

/** Per-skill значение по умолчанию (установленные harness-навыки); отсутствует → глобальный toggle. */
export function skillDefault(state: ConsoleState, itemId: string): boolean {
  const def = state.skills.defaults[itemId];
  if (typeof def === "boolean") return def;
  return state.skills.useGlobal;
}

export function setSkillDefault(state: ConsoleState, itemId: string, enabled: boolean): void {
  state.skills.defaults[itemId] = enabled;
}

export function skillRuntimeOverride(state: ConsoleState, itemId: string, runtime: string): boolean | null {
  return state.skills.runtimeOverrides[itemId]?.[runtime] ?? null;
}

/** Override уровня рантайма; value=null снимает override (наступает глобальный toggle). */
export function setSkillRuntimeOverride(
  state: ConsoleState,
  itemId: string,
  runtime: string,
  value: boolean | null,
): void {
  const per = (state.skills.runtimeOverrides[itemId] ??= {});
  if (value === null) delete per[runtime];
  else per[runtime] = value;
  if (Object.keys(per).length === 0) delete state.skills.runtimeOverrides[itemId];
}

export function setUseGlobalSkills(state: ConsoleState, value: boolean): void {
  state.skills.useGlobal = value;
}

/** Описание навыка: первая содержательная строка SKILL.md (не заголовок). */
export async function skillDescription(ctx: ProbeContext, file: string): Promise<string | undefined> {
  const text = await ctx.fs.readText(file, 2_500);
  if (!text) return undefined;
  for (const line of text.split("\n").slice(0, 12)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("---") || t.startsWith("name:") || t.startsWith("description:")) {
      continue;
    }
    return t.slice(0, 140);
  }
  return undefined;
}

/** Собрать SkillItem из найденного файла навыка (path - абсолютный путь). */
export function toSkillItem(
  ctx: ProbeContext,
  runtime: string,
  kind: SkillItem["kind"],
  name: string,
  file: string,
  relDir: string,
): SkillItem {
  const id = `${runtime}:${relDir}`;
  const source = file.startsWith(ctx.home) ? `~${file.slice(ctx.home.length)}` : file;
  return { id, runtime, name, kind, origin: "runtime", source };
}

/**
 * Harness-навыки: SKILL.md под <repoRoot>/.agents/skills (publicSkills-корень
 * из .agents/runtime/config.json). Сейчас в срезе репозитория каталога нет -
 * список будет пустым, но механизм готов.
 */
export async function collectHarnessSkills(ctx: ProbeContext): Promise<SkillItem[]> {
  const files: FileEntry[] = await ctx.fs.collectFiles(join(ctx.repoRoot, ".agents", "skills"), {
    match: (name) => name === "SKILL.md",
    maxDepth: 4,
    limit: 200,
  });
  const items: SkillItem[] = [];
  for (const f of files) {
    const relDir = f.relPath.replace(/\/SKILL\.md$/, "");
    const item: SkillItem = {
      id: `harness:${relDir}`,
      runtime: "harness",
      name: relDir.split("/").pop() ?? "skill",
      kind: "skill",
      origin: "harness",
      source: `.agents/skills/${f.relPath}`,
    };
    item.description = await skillDescription(ctx, f.path);
    items.push(item);
  }
  return items;
}
