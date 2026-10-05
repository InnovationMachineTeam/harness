import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { loadInternalSkills } from "./workflows/catalog";
import { collectHarnessSkills } from "./skills";
import { runtimeSkillLinkPath } from "./skillRegistry";
import { ensureSkillLink, removeSkillLink } from "./skillLinks";
import { runLifecycleHook } from "./lifecycleHooks";
import { fsSignals } from "@/lib/signals/fs";

/**
 * Хуки жизненного цикла навыка: enable/disable - симлинк в нативный каталог
 * рантайма обязательной рабочей папки (каноническое хранилище - .agents/skills,
 * правила размещения - core/skillLinks.ts) + опциональные команды hooks
 * манифеста; install/remove - только команды манифеста (симлинки установки и
 * удаления выполняют syncSkillLinks и skills remove). Команды исполняются
 * общим исполнителем (core/lifecycleHooks.ts): guard-проверка репозитория,
 * cwd = каталог навыка или обязательная рабочая папка. Лог -
 * .agents/console/skill-hooks.log.
 */

export interface SkillHookTarget {
  name: string;
  /** Симлинк-операции допустимы для internal/design и skills.sh (есть каталог-источник). */
  label: "internal" | "design" | "runtime" | "skills.sh" | "plugin" | "workflow";
  sourceDir?: string;
  manifestHooks?: { install: string[]; remove: string[]; enable: string[]; disable: string[] };
}

export interface SkillHookResult {
  done: string[];
  errors: string[];
}

/** Цель хука по itemId реестра; workflow и runtime-глобальные операций не имеют. */
export async function resolveHookTarget(repoRoot: string, itemId: string): Promise<SkillHookTarget | null> {
  const group = itemId.startsWith("master:") ? "master" : itemId.startsWith("design:") ? "design" : null;
  if (group) {
    const id = itemId.slice(group.length + 1);
    const entry = (await loadInternalSkills(repoRoot)).find((item) => (item.group ?? "master") === group && item.value.id === id);
    if (!entry) return null;
    return {
      name: entry.value.id,
      label: group === "design" ? "design" : "internal",
      sourceDir: path.dirname(entry.sourceFile),
      manifestHooks: entry.value.hooks,
    };
  }
  if (itemId.startsWith("harness:")) {
    const item = (await collectHarnessSkills({ repoRoot, home: process.env.HOME ?? "", fs: fsSignals, workspaces: [] }))
      .find((candidate) => candidate.id === itemId);
    if (!item) return null;
    // item.source - путь SKILL.md; симлинк и cwd хуков - каталог навыка
    return { name: item.name, label: "skills.sh", sourceDir: path.dirname(path.join(repoRoot, item.source)) };
  }
  return null;
}

/**
 * Применить переключение навыка: симлинк в обязательной папке (включение -
 * создать, выключение - удалить, только если он указывает на каталог навыка)
 * и команды hooks манифеста. Ошибки собираются; частичный результат допустим.
 */
export async function applySkillToggle(
  repoRoot: string,
  state: { workspaces: { mandatory: string } },
  itemId: string,
  runtime: string,
  enabled: boolean,
): Promise<SkillHookResult> {
  const done: string[] = [];
  const errors: string[] = [];
  const target = await resolveHookTarget(repoRoot, itemId);
  if (!target) return { done, errors };
  const workspace = state.workspaces.mandatory;
  const linkPath = runtimeSkillLinkPath(workspace, runtime, target.name);

  if (linkPath && target.sourceDir && target.label !== "runtime") {
    const writable = await access(workspace, constants.W_OK).then(() => true, () => false);
    if (!writable) {
      errors.push(`обязательная рабочая папка недоступна на запись: ${workspace}`);
    } else {
      const outcome = enabled
        ? await ensureSkillLink(repoRoot, runtime, target.name, target.sourceDir)
        : await removeSkillLink(repoRoot, runtime, target.name);
      done.push(...outcome.done);
      errors.push(...outcome.errors);
    }
  }

  const outcome = await runLifecycleHook({
    repoRoot,
    workspace,
    domain: "skill",
    name: itemId + (runtime ? ` [${runtime}]` : ""),
    op: enabled ? "enable" : "disable",
    hooks: target.manifestHooks,
    cwd: target.sourceDir,
  });
  return { done: [...done, ...outcome.done], errors: [...errors, ...outcome.errors] };
}

/** Хук установки/удаления (только команды манифеста; файловых операций нет). */
export async function runSkillHook(repoRoot: string, itemId: string, op: "install" | "remove"): Promise<SkillHookResult> {
  const target = await resolveHookTarget(repoRoot, itemId);
  if (!target?.manifestHooks) return { done: [], errors: [] };
  const outcome = await runLifecycleHook({
    repoRoot,
    workspace: repoRoot,
    domain: "skill",
    name: itemId,
    op,
    hooks: target.manifestHooks,
    cwd: target.sourceDir,
  });
  return outcome;
}
