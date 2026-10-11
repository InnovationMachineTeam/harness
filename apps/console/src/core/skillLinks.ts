import { copyFile, link, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RUNTIME_SKILL_DIRS } from "./skillRegistry";
import { collectHarnessSkills, skillEffective, type ConsoleStateLike } from "./skills";
import { loadInternalSkills } from "./workflows/catalog";
import { fsSignals } from "@/lib/signals/fs";

/**
 * Политика размещения навыков: каноническое хранилище - .agents/skills
 * (публичные - в корне, internal - master/skills, design - design/skills);
 * каталоги нативных навыков рантаймов (RUNTIME_SKILL_DIRS) содержат ссылки
 * на канонические каталоги: симлинки по умолчанию, зеркала - у рантаймов,
 * которые не следуют симлинкам (Cursor). Kimi ссылок не получает: он читает
 * .agents/skills нативно. Реальные каталоги и файлы на пути ссылки уходят
 * в бэкап .agents/.tmp/skill-links-backup; записи без канонического аналога
 * (чужие навыки, сгенерированные артефакты) синком не трогаются.
 */

const BACKUP_REL = path.join(".agents", ".tmp", "skill-links-backup");

/**
 * Исключения синка симлинков: имена навыков, записи которых в каталогах
 * рантаймов не трогаются никогда (ни замена реального каталога симлинком,
 * ни перенацеление, ни удаление). graphify - рабочий каталог: его инсталлятор
 * кладёт в каждый рантайм свой вариант (SKILL.md и hooks.md различаются),
 * каноническая копия в .agents/skills - отдельный общий вариант.
 */
export const SKILL_LINK_EXCLUDED = new Set(["graphify"]);

/** Стратегия доставки навыка в каталог рантайма: симлинк или зеркало. */
export type LinkStrategy = "symlink" | "mirror";

/**
 * Стратегии по рантаймам: по умолчанию симлинк. Cursor получает зеркало -
 * реальный каталог с hardlink'ами файлов канона: Cursor не следует симлинкам
 * в своих каталогах навыков и правил, симлинк там невидим для агента.
 */
const LINK_STRATEGY: Record<string, LinkStrategy> = { cursor: "mirror" };

function strategyFor(runtime: string): LinkStrategy {
  return LINK_STRATEGY[runtime] ?? "symlink";
}

/** Маркер управляемого зеркала в корне зеркалируемого каталога навыка. */
export const MIRROR_MARKER = ".harness-mirror.json";

interface MirrorMarker {
  target: string;
  syncedAt: string;
}

async function readMirrorMarker(mirrorDir: string): Promise<MirrorMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(mirrorDir, MIRROR_MARKER), "utf8")) as Partial<MirrorMarker>;
    return typeof parsed.target === "string" ? { target: parsed.target, syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : "" } : null;
  } catch {
    return null;
  }
}

/** Относительные пути всех файлов каталога (рекурсивно); при ошибках - пусто. */
async function listFilesRel(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(...(await listFilesRel(path.join(dir, entry.name), base)));
    else if (entry.isFile()) out.push(path.relative(base, path.join(dir, entry.name)));
  }
  return out;
}

async function sameInode(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
  return !!sa && !!sb && sa.ino === sb.ino && sa.dev === sb.dev;
}

/** Доставить файл канона в зеркало: hardlink (правки канона видны сразу,
 * один inode), при ошибке - копия; расходящийся файл замещается. */
async function mirrorFile(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true }).catch(() => undefined);
  if (await sameInode(src, dest)) return;
  await rm(dest, { force: true }).catch(() => undefined);
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

/** Удалить файл зеркала и опустевшие родительские каталоги до корня зеркала. */
async function removeFileToRoot(rootDir: string, file: string): Promise<void> {
  await rm(file, { force: true }).catch(() => undefined);
  let dir = path.dirname(file);
  while (dir.startsWith(rootDir + path.sep)) {
    const emptied = await rmdir(dir).then(() => true).catch(() => false);
    if (!emptied) break;
    dir = path.dirname(dir);
  }
}

/** Создать или обновить зеркало канонического навыка; возвращает число файлов канона. */
async function ensureMirrorDir(linkPath: string, canonicalDir: string): Promise<number> {
  await mkdir(linkPath, { recursive: true });
  const wanted = new Set(await listFilesRel(canonicalDir));
  for (const rel of wanted) await mirrorFile(path.join(canonicalDir, rel), path.join(linkPath, rel));
  for (const rel of await listFilesRel(linkPath)) {
    if (rel === MIRROR_MARKER || wanted.has(rel)) continue;
    await removeFileToRoot(linkPath, path.join(linkPath, rel));
  }
  const marker: MirrorMarker = { target: canonicalDir, syncedAt: new Date().toISOString() };
  await writeFile(path.join(linkPath, MIRROR_MARKER), JSON.stringify(marker, null, 2) + "\n");
  return wanted.size;
}

export interface LinkOpResult {
  done: string[];
  errors: string[];
}

/** Канонический навык: имя, каталог в .agents/skills и ключ тоггла. */
export interface CanonicalSkill {
  name: string;
  dir: string;
  /** Ключ в state.skills: harness:<отн.путь>, master:<id> или design:<id>. */
  itemId: string;
  /** Публичный навык - привязан ко всем рантаймам. */
  boundToAll: boolean;
  /** Привязка манифеста (только internal). */
  runtimes?: string[];
}

/** Канонические навыки .agents/skills; при совпадении имён приоритет master, затем design, затем публичный. */
export async function canonicalSkills(repoRoot: string): Promise<CanonicalSkill[]> {
  const root = await resolveRoot(repoRoot);
  const byName = new Map<string, CanonicalSkill>();
  // item.source - путь SKILL.md; каноническая цель симлинка - каталог навыка
  for (const item of await collectHarnessSkills({ repoRoot: root, home: process.env.HOME ?? "", fs: fsSignals, workspaces: [] })) {
    byName.set(item.name, { name: item.name, dir: path.dirname(path.resolve(root, item.source)), itemId: item.id, boundToAll: true });
  }
  const internal = await loadInternalSkills(root);
  for (const entry of internal) {
    if ((entry.group ?? "master") === "design") {
      byName.set(entry.value.id, {
        name: entry.value.id,
        dir: path.dirname(entry.sourceFile),
        itemId: "design:" + entry.value.id,
        boundToAll: false,
        runtimes: entry.value.runtimes,
      });
    }
  }
  for (const entry of internal) {
    if ((entry.group ?? "master") === "master") {
      byName.set(entry.value.id, {
        name: entry.value.id,
        dir: path.dirname(entry.sourceFile),
        itemId: "master:" + entry.value.id,
        boundToAll: false,
        runtimes: entry.value.runtimes,
      });
    }
  }
  return [...byName.values()];
}

/** Путь симлинка навыка в каталоге рантайма; null - рантайм без каталога (kimi). */
export function skillLinkPath(repoRoot: string, runtime: string, name: string): string | null {
  const rel = RUNTIME_SKILL_DIRS[runtime];
  return rel ? path.join(repoRoot, rel, name) : null;
}

/** Канонизация корня: путь может содержать симлинки (/tmp -> /private/tmp на macOS),
 * а сравнение целей симлинков идёт по realpath. */
async function resolveRoot(repoRoot: string): Promise<string> {
  return realpath(repoRoot).catch(() => repoRoot);
}

function insideCanonicalStorage(repoRoot: string, target: string): boolean {
  const root = path.join(repoRoot, ".agents", "skills");
  return target === root || target.startsWith(root + path.sep);
}

/** Бэкап реального каталога/файла перед заменой симлинком. */
async function backupExisting(
  repoRoot: string,
  runtime: string,
  name: string,
  linkPath: string,
): Promise<{ moved: boolean; note?: string; error?: string }> {
  const dest = path.join(repoRoot, BACKUP_REL, `${runtime}-${name}-${Date.now().toString(36)}`);
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(linkPath, dest);
    return { moved: true, note: `предыдущий каталог перенесён в ${path.relative(repoRoot, dest)}` };
  } catch (error) {
    return { moved: false, error: `бэкап не выполнен: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Создать или обновить ссылку навыка (симлинк или зеркало по стратегии
 * рантайма); реальный каталог без маркера на пути уходит в бэкап. */
export async function ensureSkillLink(repoRoot: string, runtime: string, name: string, canonicalDir: string): Promise<LinkOpResult> {
  const done: string[] = [];
  const errors: string[] = [];
  if (SKILL_LINK_EXCLUDED.has(name)) {
    errors.push(`${name}: в списке исключений синка симлинков - не трогаю`);
    return { done, errors };
  }
  const root = await resolveRoot(repoRoot);
  const linkPath = skillLinkPath(root, runtime, name);
  if (!linkPath) return { done, errors };
  const target = path.resolve(canonicalDir);
  const runMirror = async (): Promise<void> => {
    const files = await ensureMirrorDir(linkPath, target);
    done.push(`${path.relative(root, linkPath)} = зеркало ${path.relative(root, target)} (${files} файлов)`);
  };
  if (strategyFor(runtime) === "mirror") {
    if (await readMirrorMarker(linkPath)) {
      await runMirror().catch((error: unknown) => errors.push(`зеркало не обновлено: ${error instanceof Error ? error.message : String(error)}`));
      return { done, errors };
    }
    const info = await lstat(linkPath).catch(() => null);
    if (info?.isSymbolicLink()) {
      await unlink(linkPath).catch(() => undefined);
    } else if (info) {
      const backup = await backupExisting(root, runtime, name, linkPath);
      if (backup.error) errors.push(backup.error);
      if (backup.note) done.push(backup.note);
      if (!backup.moved) return { done, errors };
    }
    await runMirror().catch((error: unknown) => errors.push(`зеркало не создано: ${error instanceof Error ? error.message : String(error)}`));
    return { done, errors };
  }
  const info = await lstat(linkPath).catch(() => null);
  if (info?.isSymbolicLink()) {
    const points = await realpath(linkPath).catch(() => "");
    if (points === target) return { done, errors };
    await unlink(linkPath).catch(() => undefined);
  } else if (info) {
    const backup = await backupExisting(root, runtime, name, linkPath);
    if (backup.error) errors.push(backup.error);
    if (backup.note) done.push(backup.note);
    if (!backup.moved) return { done, errors };
  }
  await mkdir(path.dirname(linkPath), { recursive: true }).catch(() => undefined);
  await symlink(target, linkPath)
    .then(() => done.push(`${path.relative(root, linkPath)} -> ${path.relative(root, target)}`))
    .catch((error: unknown) => errors.push(`симлинк не создан: ${error instanceof Error ? error.message : String(error)}`));
  return { done, errors };
}

/** Удалить ссылку навыка, только если она управляемая: симлинк - указывающий
 * в каноническое хранилище, зеркало - с валидным маркером. */
export async function removeSkillLink(repoRoot: string, runtime: string, name: string): Promise<LinkOpResult> {
  const done: string[] = [];
  const errors: string[] = [];
  if (SKILL_LINK_EXCLUDED.has(name)) {
    errors.push(`${name}: в списке исключений синка симлинков - не трогаю`);
    return { done, errors };
  }
  const root = await resolveRoot(repoRoot);
  const linkPath = skillLinkPath(root, runtime, name);
  if (!linkPath) return { done, errors };
  const info = await lstat(linkPath).catch(() => null);
  if (!info) return { done, errors };
  if (strategyFor(runtime) === "mirror") {
    const marker = await readMirrorMarker(linkPath);
    if (!marker) {
      errors.push(`${path.relative(root, linkPath)}: занят реальным каталогом без маркера зеркала - выполните синк симлинков`);
      return { done, errors };
    }
    const points = await realpath(marker.target).catch(() => "");
    if (!insideCanonicalStorage(root, points)) {
      errors.push(`${path.relative(root, linkPath)}: маркер зеркала указывает вне .agents/skills - не удаляю`);
      return { done, errors };
    }
    await rm(linkPath, { recursive: true, force: true })
      .then(() => done.push(`${path.relative(root, linkPath)} (зеркало) удалён`))
      .catch((error: unknown) => errors.push(`зеркало не удалено: ${error instanceof Error ? error.message : String(error)}`));
    return { done, errors };
  }
  if (!info.isSymbolicLink()) {
    errors.push(`${path.relative(root, linkPath)}: занят реальным каталогом - выполните синк симлинков`);
    return { done, errors };
  }
  const points = await realpath(linkPath).catch(() => "");
  if (!insideCanonicalStorage(root, points)) {
    errors.push(`${path.relative(root, linkPath)}: симлинк указывает вне .agents/skills - не удаляю`);
    return { done, errors };
  }
  await unlink(linkPath)
    .then(() => done.push(`${path.relative(root, linkPath)} удалён`))
    .catch((error: unknown) => errors.push(`симлинк не удалён: ${error instanceof Error ? error.message : String(error)}`));
  return { done, errors };
}

/** Желаемые симлинки по рантаймам: привязка манифеста (internal), эффективный тоггл,
 * минус исключения синка (SKILL_LINK_EXCLUDED). */
export async function desiredSkillLinks(repoRoot: string, state: ConsoleStateLike): Promise<Map<string, Map<string, string>>> {
  const root = await resolveRoot(repoRoot);
  const skills = await canonicalSkills(root);
  const result = new Map<string, Map<string, string>>();
  for (const runtime of Object.keys(RUNTIME_SKILL_DIRS)) {
    const desired = new Map<string, string>();
    for (const skill of skills) {
      if (SKILL_LINK_EXCLUDED.has(skill.name)) continue;
      if (!skill.boundToAll && !(skill.runtimes ?? []).includes(runtime)) continue;
      if (!skillEffective(state, skill.itemId, runtime)) continue;
      desired.set(skill.name, skill.dir);
    }
    result.set(runtime, desired);
  }
  return result;
}

/** Отчёт синка симлинков одного рантайма. */
export interface SkillLinksReport {
  runtime: string;
  relDir: string;
  /** Созданные или перенацеленные симлинки. */
  linked: string[];
  /** Удалённые симлинки (вне желаемого набора, битые) и убранные в бэкап реальные каталоги. */
  removed: string[];
  /** Реальные каталоги, заменённые симлинками или убранные в бэкап. */
  normalized: string[];
  /** Чужие записи - оставлены без изменений. */
  kept: string[];
  errors: string[];
}

/**
 * Синк симлинков навыков в обязательной рабочей папке: желаемые симлинки
 * создаются и перенацеливаются, лишние управляемые симлинки и реальные каталоги
 * с каноническим аналогом убираются (с бэкапом), битые симлинки удаляются,
 * чужие записи остаются.
 */
export async function syncSkillLinks(repoRoot: string, state: ConsoleStateLike): Promise<SkillLinksReport[]> {
  const root = await resolveRoot(repoRoot);
  const desiredByRuntime = await desiredSkillLinks(root, state);
  const canonicalByName = new Map((await canonicalSkills(root)).map((skill) => [skill.name, skill.dir]));
  const reports: SkillLinksReport[] = [];
  for (const [runtime, desired] of desiredByRuntime) {
    const relDir = RUNTIME_SKILL_DIRS[runtime];
    const dir = path.join(root, relDir);
    const report: SkillLinksReport = { runtime, relDir, linked: [], removed: [], normalized: [], kept: [], errors: [] };
    try {
      await mkdir(dir, { recursive: true }).catch(() => undefined);
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (SKILL_LINK_EXCLUDED.has(entry.name)) {
          report.kept.push(entry.name);
          continue;
        }
        const linkPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          const target = await stat(linkPath).catch(() => null);
          if (!target) {
            await unlink(linkPath).catch(() => undefined);
            report.removed.push(`${entry.name} (битый симлинк)`);
            continue;
          }
          if (desired.has(entry.name)) {
            // желаемый симлинк: перенацеливание, если указывает не в канон
            const outcome = await ensureSkillLink(root, runtime, entry.name, desired.get(entry.name)!);
            report.errors.push(...outcome.errors);
            if (outcome.done.length) report.linked.push(entry.name);
            continue;
          }
          const points = await realpath(linkPath).catch(() => "");
          if (insideCanonicalStorage(root, points)) {
            await unlink(linkPath).catch(() => undefined);
            report.removed.push(entry.name);
          } else {
            report.kept.push(entry.name);
          }
          continue;
        }
        if (entry.isDirectory() && canonicalByName.has(entry.name)) {
          // реальный каталог канонического навыка: заменяется ссылкой (желаемый)
          // или убирается в бэкап (выключенный)
          if (desired.has(entry.name)) {
            const hadMarker = strategyFor(runtime) === "mirror" && !!(await readMirrorMarker(linkPath));
            const outcome = await ensureSkillLink(root, runtime, entry.name, desired.get(entry.name)!);
            report.errors.push(...outcome.errors);
            if (!hadMarker) report.normalized.push(entry.name);
            report.linked.push(entry.name);
          } else {
            const outcome = await backupAndRemove(root, runtime, entry.name, linkPath);
            report.errors.push(...outcome.errors);
            if (outcome.moved) {
              report.normalized.push(entry.name);
              report.removed.push(entry.name);
            }
          }
          continue;
        }
        if (entry.isDirectory() && strategyFor(runtime) === "mirror" && (await readMirrorMarker(linkPath))) {
          // зеркало навыка, исчезнувшего из канонического хранилища
          const outcome = await backupAndRemove(root, runtime, entry.name, linkPath);
          report.errors.push(...outcome.errors);
          if (outcome.moved) {
            report.normalized.push(entry.name);
            report.removed.push(entry.name);
          }
          continue;
        }
        report.kept.push(entry.name);
      }
      for (const [name, canonicalDir] of desired) {
        const existing = await lstat(path.join(dir, name)).catch(() => null);
        if (existing) continue;
        const outcome = await ensureSkillLink(root, runtime, name, canonicalDir);
        if (outcome.done.length) report.linked.push(name);
        report.errors.push(...outcome.errors);
      }
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
    reports.push(report);
  }
  return reports;
}

async function backupAndRemove(
  repoRoot: string,
  runtime: string,
  name: string,
  linkPath: string,
): Promise<{ moved: boolean; errors: string[] }> {
  const backup = await backupExisting(repoRoot, runtime, name, linkPath);
  const errors = backup.error ? [backup.error] : [];
  if (!backup.moved) return { moved: false, errors };
  await rm(linkPath, { recursive: true, force: true }).catch(() => undefined);
  return { moved: true, errors };
}

/** Запись статуса одного навыка в каталоге рантайма. */
export interface SkillLinkEntry {
  name: string;
  kind: "link" | "mirror" | "real" | "broken" | "other";
  /** Куда указывает симлинк или зеркало (относительный путь) или признак чужой записи. */
  points?: string;
}

export interface SkillLinksStatus {
  runtime: string;
  relDir: string;
  entries: SkillLinkEntry[];
  /** Желаемые симлинки, которых нет. */
  missing: string[];
}

/** Статус симлинков без записи: что в каталогах и чего не хватает. */
export async function skillLinksStatus(repoRoot: string, state: ConsoleStateLike): Promise<SkillLinksStatus[]> {
  const root = await resolveRoot(repoRoot);
  const desiredByRuntime = await desiredSkillLinks(root, state);
  const statuses: SkillLinksStatus[] = [];
  for (const [runtime, desired] of desiredByRuntime) {
    const relDir = RUNTIME_SKILL_DIRS[runtime];
    const dir = path.join(root, relDir);
    const status: SkillLinksStatus = { runtime, relDir, entries: [], missing: [] };
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const linkPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await stat(linkPath).catch(() => null);
        if (!target) {
          status.entries.push({ name: entry.name, kind: "broken" });
          continue;
        }
        const points = await realpath(linkPath).catch(() => "");
        status.entries.push({
          name: entry.name,
          kind: "link",
          points: insideCanonicalStorage(root, points) ? path.relative(path.join(root, ".agents", "skills"), points) : "вне .agents/skills",
        });
        continue;
      }
      if (entry.isDirectory() && strategyFor(runtime) === "mirror") {
        const marker = await readMirrorMarker(linkPath);
        if (marker) {
          const points = await realpath(marker.target).catch(() => "");
          status.entries.push({
            name: entry.name,
            kind: "mirror",
            points: insideCanonicalStorage(root, points) ? path.relative(path.join(root, ".agents", "skills"), points) : "вне .agents/skills",
          });
          continue;
        }
      }
      status.entries.push({ name: entry.name, kind: entry.isDirectory() ? "real" : "other" });
    }
    for (const name of desired.keys()) {
      const existing = await lstat(path.join(dir, name)).catch(() => null);
      if (!existing) status.missing.push(name);
    }
    statuses.push(status);
  }
  return statuses;
}
