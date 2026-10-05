import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Мультирепозиторные вики-воркспейсы openwiki 0.6+: реестр -
 * ~/.openwiki/wiki-workspaces.json (или $OPENWIKI_CONFIG_DIR), формат строго
 * валидируется при чтении самим openwiki. `openwiki link` - интерактивный
 * TUI, неинтерактивного пути в CLI нет, поэтому консоль правит реестр напрямую
 * с теми же ограничениями (slug-id, ≥2 вики, вики = git-репо с
 * openwiki/.last-update.json) и атомарной записью; use/clear - правка поля
 * active. Состав/активность используются openwiki только для областей поиска
 * (MCP openwiki_search), на --init/--update они не влияют.
 */

export const WORKSPACE_REGISTRY_BASENAME = "wiki-workspaces.json";

export interface WikiRegistryEntry {
  /** Slug (/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/). */
  id: string;
  name: string;
  /** Канонический абсолютный путь git-репозитория. */
  root: string;
}

export interface WorkspaceRegistry {
  version: number;
  wikis: WikiRegistryEntry[];
  workspaces: { id: string; name: string; wikis: string[] }[];
  /** Активный воркспейс по id вики. */
  active: { wiki: string; workspace: string }[];
}

export function wikiWorkspaceRegistryPath(configDir?: string): string {
  const home = configDir ?? (process.env.OPENWIKI_CONFIG_DIR || path.join(homedir(), ".openwiki"));
  return path.join(home, WORKSPACE_REGISTRY_BASENAME);
}

const WIKI_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const NAME_RE = /^[\x20-\x7E\u0400-\u04FF]{1,80}$/;

/** Прочитать реестр; отсутствующий или повреждённый файл - null. */
export async function readWorkspaceRegistry(configDir?: string): Promise<WorkspaceRegistry | null> {
  try {
    const raw = JSON.parse(await readFile(wikiWorkspaceRegistryPath(configDir), "utf8")) as Partial<WorkspaceRegistry>;
    if (typeof raw.version !== "number") return null;
    if (!Array.isArray(raw.wikis) || !Array.isArray(raw.workspaces) || !Array.isArray(raw.active)) return null;
    for (const wiki of raw.wikis) {
      if (!wiki || !WIKI_ID_RE.test(wiki.id) || !path.isAbsolute(wiki.root)) return null;
    }
    for (const ws of raw.workspaces) {
      if (!ws || !WIKI_ID_RE.test(ws.id) || !Array.isArray(ws.wikis) || ws.wikis.length < 2) return null;
    }
    return { version: raw.version, wikis: raw.wikis, workspaces: raw.workspaces, active: raw.active };
  } catch {
    return null;
  }
}

/** Атомарная запись реестра (tmp + rename, каталог создаётся, права 0600). */
export async function writeWorkspaceRegistry(registry: WorkspaceRegistry, configDir?: string): Promise<void> {
  const file = wikiWorkspaceRegistryPath(configDir);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

/** Имя-слаг из названия: латиница/кириллица → дефисы; null - после очистки пусто. */
export function wikiIdFromName(name: string): string | null {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
    м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const translit = [...name.toLowerCase()].map((ch) => map[ch] ?? ch).join("");
  const slug = translit.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/^-+|-+$/g, "");
  return WIKI_ID_RE.test(slug) ? slug : null;
}

/** Проверка имени: печатаемое, до 80 символов, уникальность проверяет вызывающий. */
export function isValidWorkspaceName(name: string): boolean {
  return NAME_RE.test(name.trim());
}

/**
 * Вики-корень папки: canonical путь + обязательный маркер собранной вики
 * (openwiki/.last-update.json) - правило openwiki для участника воркспейса.
 */
export async function wikiRootFor(workspaceDir: string): Promise<string | null> {
  const marker = path.join(workspaceDir, "openwiki", ".last-update.json");
  const ok = await stat(marker).then(
    () => true,
    () => false,
  );
  if (!ok) return null;
  try {
    return await realpath(workspaceDir);
  } catch {
    return null;
  }
}

export interface WikiWorkspaceOverview {
  registry: WorkspaceRegistry;
  /** Состояние по каждой рабочей папке консоли. */
  folders: {
    dir: string;
    name: string;
    /** Папка - зарегистрированная вики (по canonical root). */
    wikiId: string | null;
    /** Собранная вики (маркер .last-update.json) - может стать участником. */
    linkable: boolean;
    active: string | null;
    /** Воркспейсы, содержащие эту вики. */
    containing: { id: string; name: string }[];
  }[];
}

/** Обзор: реестр + состояние каждой рабочей папки (без вызовов CLI). */
export async function workspaceOverview(dirs: string[], configDir?: string): Promise<WikiWorkspaceOverview> {
  const registry =
    (await readWorkspaceRegistry(configDir)) ?? { version: 1, wikis: [], workspaces: [], active: [] };
  const roots = new Map(registry.wikis.map((w) => [w.root, w.id]));
  const folders = await Promise.all(
    dirs.map(async (dir) => {
      const real = await realpath(dir).catch(() => null);
      const wikiId = real ? roots.get(real) ?? null : null;
      const linkable = real ? (await wikiRootFor(dir)) !== null : false;
      const activeEntry = wikiId ? registry.active.find((a) => a.wiki === wikiId) : undefined;
      const containing = wikiId
        ? registry.workspaces
            .filter((ws) => ws.wikis.includes(wikiId))
            .map((ws) => ({ id: ws.id, name: ws.name }))
        : [];
      return {
        dir,
        name: path.basename(dir),
        wikiId,
        linkable,
        active: activeEntry?.workspace ?? null,
        containing,
      };
    }),
  );
  return { registry, folders };
}

export type WorkspaceMutation =
  | { ok: true; registry: WorkspaceRegistry }
  | { ok: false; error: string };

/** Мутация реестра под защитой перечитывания и валидации. */
async function mutateRegistry(
  configDir: string | undefined,
  mutate: (registry: WorkspaceRegistry) => WorkspaceMutation | Promise<WorkspaceMutation>,
): Promise<WorkspaceMutation> {
  const registry =
    (await readWorkspaceRegistry(configDir)) ?? { version: 1, wikis: [], workspaces: [], active: [] };
  const result = await mutate(registry);
  if (!result.ok) return result;
  await writeWorkspaceRegistry(result.registry, configDir);
  return result;
}

/**
 * Создать воркспейс: name + ≥2 рабочие папки с собранной вики. Незарегистрированные
 * вики добавляются в реестр (id - slug имени папки), повторы имён отклоняются.
 */
export async function createWorkspace(
  name: string,
  dirs: string[],
  configDir?: string,
): Promise<WorkspaceMutation> {
  const cleanName = name.trim();
  if (!isValidWorkspaceName(cleanName)) return { ok: false, error: "недопустимое имя воркспейса" };
  if (dirs.length < 2) return { ok: false, error: "воркспейсу нужны минимум две папки с собранной вики" };
  const roots: { id: string; name: string; root: string }[] = [];
  for (const dir of dirs) {
    const root = await wikiRootFor(dir);
    if (!root) return { ok: false, error: `в папке ${dir} нет собранной вики (openwiki/.last-update.json)` };
    roots.push({ id: "", name: path.basename(root), root });
  }
  return mutateRegistry(configDir, (registry) => {
    if (registry.workspaces.some((ws) => ws.name.toLowerCase() === cleanName.toLowerCase())) {
      return { ok: false, error: `воркспейс с именем "${cleanName}" уже есть` };
    }
    const wsId = wikiIdFromName(cleanName);
    if (!wsId) return { ok: false, error: "не удалось составить идентификатор из имени" };
    if (registry.workspaces.some((ws) => ws.id === wsId)) {
      return { ok: false, error: `воркспейс с идентификатором "${wsId}" уже есть` };
    }
    const wikiIds: string[] = [];
    for (const entry of roots) {
      const known = registry.wikis.find((w) => w.root === entry.root);
      if (known) {
        wikiIds.push(known.id);
        continue;
      }
      const base = wikiIdFromName(entry.name) ?? `wiki-${registry.wikis.length + 1}`;
      let id = base;
      let n = 2;
      while (registry.wikis.some((w) => w.id === id)) id = `${base}-${n++}`;
      registry.wikis.push({ id, name: entry.name, root: entry.root });
      wikiIds.push(id);
    }
    registry.workspaces.push({ id: wsId, name: cleanName, wikis: wikiIds });
    return { ok: true, registry };
  });
}

/** Активный воркспейс папки: workspaceId (use) или null (clear). */
export async function setActiveWorkspace(
  dir: string,
  workspaceId: string | null,
  configDir?: string,
): Promise<WorkspaceMutation> {
  const real = await realpath(dir).catch(() => null);
  if (!real) return { ok: false, error: "папка не найдена" };
  return mutateRegistry(configDir, (registry) => {
    const wiki = registry.wikis.find((w) => w.root === real);
    if (!wiki) return { ok: false, error: "папка не зарегистрирована как вики - сначала соберите вики и создайте воркспейс" };
    if (workspaceId !== null && !registry.workspaces.some((ws) => ws.id === workspaceId)) {
      return { ok: false, error: "воркспейс не найден" };
    }
    registry.active = registry.active.filter((a) => a.wiki !== wiki.id);
    if (workspaceId !== null) registry.active.push({ wiki: wiki.id, workspace: workspaceId });
    return { ok: true, registry };
  });
}

/** Удалить воркспейс (участники-вики остаются в реестре). */
export async function deleteWorkspace(workspaceId: string, configDir?: string): Promise<WorkspaceMutation> {
  return mutateRegistry(configDir, (registry) => {
    if (!registry.workspaces.some((ws) => ws.id === workspaceId)) {
      return { ok: false, error: "воркспейс не найден" };
    }
    registry.workspaces = registry.workspaces.filter((ws) => ws.id !== workspaceId);
    registry.active = registry.active.filter((a) => a.workspace !== workspaceId);
    return { ok: true, registry };
  });
}
