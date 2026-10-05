import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PackageManager } from "./state";
import type { ToolJobStep, ToolJobStepResult } from "./toolJobs";
import { globalInstallCommand, globalPackageVersion, readPackageManagerPref } from "./tools";

/**
 * Реестр зависимостей и проверка обновлений (вкладка "Настройки → Обновить").
 *
 * Реестр - .agents/console/updates.json: все зависимости harness (локальные
 * npm-пакеты workspace и глобальные инструменты) с текущими версиями, свежими
 * версиями после проверки и статусами последнего запуска обновления. При
 * синхронизации появившийся инструмент попадает в реестр, удалённый -
 * удаляется, статусы сохраняются. Команды обновления строятся только на
 * сервере из реестра - клиент присылает идентификаторы; оболочка не
 * привлекается. Все spawn-вызовы - литеральные имена программ и литеральные
 * массивы аргументов (как allowlist в core/tools.ts).
 */

export type UpdateGroup = "local" | "global";
/** Управляющий инструмент строки (бейдж в UI). */
export type UpdateKind = "bun" | "npm" | "uv" | "brew" | "system";

export interface UpdateTarget {
  /** Стабильный идентификатор: "local:<pkg>", "global:npm|uv|brew|system:<name>". */
  id: string;
  group: UpdateGroup;
  kind: UpdateKind;
  name: string;
  currentVersion: string | null;
  /** Команда обновления (argv без оболочки); null - обновление вручную. */
  command: string[] | null;
  cwd: string | null;
  note?: string;
}

export interface RegistryItem extends UpdateTarget {
  latestVersion: string | null;
  updateAvailable: boolean;
  lastUpdateStatus: "success" | "error" | null;
  lastUpdateAt: string | null;
}

export interface UpdateRegistry {
  /** Время последней сетевой проверки (ISO); null - проверка не выполнялась. */
  checkedAt: string | null;
  items: Record<string, RegistryItem>;
}

export interface UpdateRegistryDTO {
  checkedAt: string | null;
  local: RegistryItem[];
  global: RegistryItem[];
}

/* ------------------------------- константы --------------------------------- */

/** npm-глобальные пакеты harness (setup.sh: $(npm_global) <pkg>). */
const NPM_GLOBAL_PACKAGES = ["openwiki", "@tobilu/qmd", "@colbymchenry/codegraph", "nx"] as const;

/** uv-инструменты harness: бинарник → пакет PyPI (спек обновления сохраняет extras). */
const UV_TOOLS = [
  { bin: "serena", pypi: "serena-agent", upgrade: "serena-agent" },
  { bin: "graphify", pypi: "graphifyy", upgrade: "graphifyy" },
  { bin: "headroom", pypi: "headroom-ai", upgrade: "headroom-ai[all]" },
] as const;

/** Диапазоны версий, которые не обновляются по отдельности. */
const SKIPPED_RANGE_PROTOCOLS = ["workspace:", "link:", "file:", "catalog:"];

/** Квант сетевых проверок (параллельные загрузки реестров). */
const FETCH_BATCH_SIZE = 8;

/* ------------------------------ файл реестра -------------------------------- */

export function updatesRegistryPath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "updates.json");
}

export function readUpdateRegistry(repoRoot: string): UpdateRegistry {
  try {
    const raw = JSON.parse(readFileSync(updatesRegistryPath(repoRoot), "utf8")) as UpdateRegistry;
    if (raw && typeof raw === "object" && raw.items && typeof raw.items === "object") {
      return {
        checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : null,
        items: raw.items,
      };
    }
  } catch {
    /* файла нет или повреждён - пустой реестр */
  }
  return { checkedAt: null, items: {} };
}

function writeUpdateRegistry(repoRoot: string, registry: UpdateRegistry): void {
  const file = updatesRegistryPath(repoRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

/* --------------------------- сбор целей (без сети) --------------------------- */

/** Все зависимости harness: локальные пакеты workspace + глобальные инструменты. */
export async function collectUpdateTargets(repoRoot: string): Promise<UpdateTarget[]> {
  const pm = await readPackageManagerPref(repoRoot);
  return [...collectLocalPackageTargets(repoRoot), ...collectGlobalToolTargets(pm)];
}

/**
 * Локальные пакеты: dependencies + devDependencies manifest'ов workspace
 * (корень + шаблоны поля workspaces). Внутренние @harness/* и неустановленные
 * пакеты не попадают в реестр. cwd команды - каталог workspace, объявившего
 * зависимость: `bun update <pkg>` действует в пределах своего workspace
 * (запуск из корня даёт "not a dependency of this workspace" для пакетов
 * вложенных проектов).
 */
function collectLocalPackageTargets(repoRoot: string): UpdateTarget[] {
  const manifests = workspaceManifestPaths(repoRoot);
  const declaringDir = new Map<string, string>();
  for (const file of manifests) {
    const manifest = readJsonFile(file) as { dependencies?: unknown; devDependencies?: unknown } | null;
    if (!manifest) continue;
    for (const section of [manifest.dependencies, manifest.devDependencies]) {
      if (!section || typeof section !== "object") continue;
      for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
        if (typeof range !== "string") continue;
        if (name.startsWith("@harness/")) continue;
        if (SKIPPED_RANGE_PROTOCOLS.some((protocol) => range.startsWith(protocol))) continue;
        if (!declaringDir.has(name)) declaringDir.set(name, path.dirname(file));
      }
    }
  }
  // bun поднимает пакеты в корневой node_modules; фолбэк - node_modules рядом с manifest'ом
  const searchDirs = [repoRoot, ...new Set(manifests.map((file) => path.dirname(file)))];
  const targets: UpdateTarget[] = [];
  for (const [name, dir] of [...declaringDir].sort(([a], [b]) => a.localeCompare(b))) {
    const version = installedPackageVersion(searchDirs, name);
    if (!version) continue;
    targets.push({
      id: `local:${name}`,
      group: "local",
      kind: "bun",
      name,
      currentVersion: version,
      command: ["bun", "update", "--latest", name],
      cwd: dir,
    });
  }
  return targets;
}

/** Пути package.json: корень + разрешение шаблонов поля workspaces ("apps/*", "tooling/harness"). */
function workspaceManifestPaths(repoRoot: string): string[] {
  const files = [path.join(repoRoot, "package.json")];
  const root = readJsonFile(files[0]) as { workspaces?: unknown } | null;
  const patterns = Array.isArray(root?.workspaces)
    ? root.workspaces.filter((p): p is string => typeof p === "string")
    : [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const dir = path.join(repoRoot, pattern.slice(0, -2));
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const file = path.join(dir, entry, "package.json");
        if (existsSync(file)) files.push(file);
      }
    } else {
      const file = path.join(repoRoot, pattern, "package.json");
      if (existsSync(file)) files.push(file);
    }
  }
  return files;
}

function installedPackageVersion(searchDirs: string[], name: string): string | null {
  for (const dir of searchDirs) {
    const file = path.join(dir, "node_modules", name, "package.json");
    const manifest = readJsonFile(file) as { version?: unknown } | null;
    if (manifest && typeof manifest.version === "string" && manifest.version) return manifest.version;
  }
  return null;
}

function collectGlobalToolTargets(pm: PackageManager): UpdateTarget[] {
  const targets: UpdateTarget[] = [];

  // npm-глобальные пакеты: менеджер - выбор из .agents/console/package-manager.json
  for (const pkg of NPM_GLOBAL_PACKAGES) {
    const version = globalPackageVersion(pkg);
    if (!version) continue;
    targets.push({
      id: `global:npm:${pkg}`,
      group: "global",
      kind: pm,
      name: pkg,
      currentVersion: version,
      command: globalInstallCommand(pm, `${pkg}@latest`),
      cwd: null,
    });
  }

  // uv-инструменты (имя в реестре - пакет PyPI, по нему же проверка свежей версии)
  const uvTools = parseUvToolList(uvToolListOutput());
  for (const tool of UV_TOOLS) {
    const version = uvTools.get(tool.pypi);
    if (!version) continue;
    targets.push({
      id: `global:uv:${tool.pypi}`,
      group: "global",
      kind: "uv",
      name: tool.pypi,
      currentVersion: version,
      command: ["uv", "tool", "upgrade", tool.upgrade],
      cwd: null,
    });
  }

  // bun обновляет сам себя
  const bunVersion = cliVersion("bun");
  if (bunVersion) {
    targets.push({
      id: "global:system:bun",
      group: "global",
      kind: "system",
      name: "bun",
      currentVersion: bunVersion,
      command: ["bun", "upgrade"],
      cwd: null,
    });
  }

  // uv как системный инструмент: brew-владение определяет команду
  const uvVersion = cliVersion("uv");
  if (uvVersion) {
    if (brewOwnedFormula("uv")) {
      targets.push({
        id: "global:brew:uv",
        group: "global",
        kind: "brew",
        name: "uv",
        currentVersion: uvVersion,
        command: ["brew", "upgrade", "uv"],
        cwd: null,
      });
    } else {
      targets.push({
        id: "global:system:uv",
        group: "global",
        kind: "system",
        name: "uv",
        currentVersion: uvVersion,
        command: ["uv", "self", "update"],
        cwd: null,
      });
    }
  }

  // node: под brew - команда; иначе - пометка о ручном обновлении
  const nodeVersionValue = nodeVersion();
  if (nodeVersionValue) {
    if (brewOwnedFormula("node")) {
      targets.push({
        id: "global:brew:node",
        group: "global",
        kind: "brew",
        name: "node",
        currentVersion: nodeVersionValue,
        command: ["brew", "upgrade", "node"],
        cwd: null,
      });
    } else {
      targets.push({
        id: "global:system:node",
        group: "global",
        kind: "system",
        name: "node",
        currentVersion: nodeVersionValue,
        command: null,
        cwd: null,
        note: "не управляется brew - обновление вручную (см. setup.sh)",
      });
    }
  }

  // rtk: macOS под brew; установка установщиком - обновление вручную
  const rtkVersion = cliVersion("rtk");
  if (rtkVersion) {
    if (process.platform === "darwin" && brewOwnedFormula("rtk")) {
      targets.push({
        id: "global:brew:rtk",
        group: "global",
        kind: "brew",
        name: "rtk",
        currentVersion: rtkVersion,
        command: ["brew", "upgrade", "rtk"],
        cwd: null,
      });
    } else {
      targets.push({
        id: "global:system:rtk",
        group: "global",
        kind: "system",
        name: "rtk",
        currentVersion: rtkVersion,
        command: null,
        cwd: null,
        note: "обновление установщиком rtk - вручную (см. setup.sh)",
      });
    }
  }

  return targets;
}

/* ------------------------- сетевая проверка свежих версий -------------------- */

/**
 * Свежие версии по целям. Значение null - проверить не удалось (в реестре
 * сохраняется прошлое значение). Для brew отсутствие формулы в `brew outdated`
 * трактуется как актуальная версия.
 */
export async function fetchLatestVersions(targets: UpdateTarget[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  for (const target of targets) result.set(target.id, null);

  const brewIds = targets.filter((target) => target.kind === "brew");
  if (brewIds.length > 0) {
    const brewOk = brewUpdateQuiet();
    const outdated = brewOk ? parseBrewOutdated(brewOutdatedJson()) : new Map<string, string>();
    for (const target of brewIds) {
      if (!brewOk) continue;
      result.set(target.id, outdated.get(target.name) ?? target.currentVersion);
    }
  }

  const sources = new Map<string, { fetch(): Promise<string | null>; ids: string[] }>();
  for (const target of targets) {
    const fetcher = latestSourceFetcher(target);
    if (!fetcher) continue;
    const group = sources.get(fetcher.key) ?? { fetch: fetcher.fetch, ids: [] };
    group.ids.push(target.id);
    sources.set(fetcher.key, group);
  }
  const tasks = [...sources.values()].map(
    (source) => async (): Promise<void> => {
      const version = await source.fetch();
      if (version === null) return;
      for (const id of source.ids) result.set(id, version);
    },
  );
  for (let i = 0; i < tasks.length; i += FETCH_BATCH_SIZE) {
    await Promise.all(tasks.slice(i, i + FETCH_BATCH_SIZE).map((task) => task().catch(() => {})));
  }
  return result;
}

/** Источник свежей версии цели; null - brew (обрабатывается отдельно) или ручное обновление. */
function latestSourceFetcher(
  target: UpdateTarget,
): { key: string; fetch(): Promise<string | null> } | null {
  const npmFetcher = (name: string): { key: string; fetch(): Promise<string | null> } => ({
    key: `npm:${name}`,
    fetch: async () =>
      latestFromNpmPayload(await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)),
  });
  const pypiFetcher = (name: string): { key: string; fetch(): Promise<string | null> } => ({
    key: `pypi:${name}`,
    fetch: async () =>
      latestFromPypiPayload(await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)),
  });
  const githubFetcher = (repo: string, strip: RegExp): { key: string; fetch(): Promise<string | null> } => ({
    key: `github:${repo}`,
    fetch: async () =>
      latestFromGithubTag(await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`), strip),
  });
  if (target.group === "local") return npmFetcher(target.name);
  if (target.kind === "npm" || target.kind === "bun") return npmFetcher(target.name);
  if (target.kind === "uv") return pypiFetcher(target.name);
  if (target.id === "global:system:bun") return githubFetcher("oven-sh/bun", /^bun-v/);
  if (target.id === "global:system:uv") return githubFetcher("astral-sh/uv", /^v/);
  return null;
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "harness-console" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ----------------------------- парсеры (для тестов) ------------------------- */

/** `uv tool list`: строки "имя vX.Y.Z" → версия по имени пакета PyPI. */
export function parseUvToolList(output: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+)\s+v(\S+)\s*$/);
    if (match) result.set(match[1], match[2]);
  }
  return result;
}

/** `brew outdated --json=v2`: имя → свежая версия (поле current_version). */
export function parseBrewOutdated(payload: unknown): Map<string, string> {
  const result = new Map<string, string>();
  const sections = (payload ?? {}) as { formulae?: unknown; casks?: unknown };
  const rows = [
    ...(Array.isArray(sections.formulae) ? sections.formulae : []),
    ...(Array.isArray(sections.casks) ? sections.casks : []),
  ];
  for (const entry of rows) {
    const row = entry as { name?: unknown; current_version?: unknown };
    if (typeof row.name === "string" && typeof row.current_version === "string" && row.current_version) {
      result.set(row.name, row.current_version);
    }
  }
  return result;
}

export function latestFromNpmPayload(payload: unknown): string | null {
  const version = (payload as { version?: unknown } | null)?.version;
  return typeof version === "string" && version ? version : null;
}

export function latestFromPypiPayload(payload: unknown): string | null {
  const version = (payload as { info?: { version?: unknown } } | null)?.info?.version;
  return typeof version === "string" && version ? version : null;
}

export function latestFromGithubTag(payload: unknown, strip: RegExp): string | null {
  const tag = (payload as { tag_name?: unknown } | null)?.tag_name;
  if (typeof tag !== "string") return null;
  return tag.replace(strip, "").replace(/^v/, "") || null;
}

/* --------------------------- синхронизация реестра -------------------------- */

/**
 * Слияние целей с реестром: новые цели добавляются, исчезнувшие удаляются,
 * статусы запусков и прошлые свежие версии сохраняются; признак устаревания
 * пересчитывается по сохранённой свежей версии. Записывает файл.
 */
export function syncUpdateRegistry(repoRoot: string, targets: UpdateTarget[]): UpdateRegistry {
  const prev = readUpdateRegistry(repoRoot);
  const items: Record<string, RegistryItem> = {};
  for (const target of targets) {
    const before = prev.items[target.id];
    const latestVersion = before?.latestVersion ?? null;
    items[target.id] = {
      ...target,
      latestVersion,
      updateAvailable: Boolean(latestVersion && target.currentVersion && latestVersion !== target.currentVersion),
      lastUpdateStatus: before?.lastUpdateStatus ?? null,
      lastUpdateAt: before?.lastUpdateAt ?? null,
    };
  }
  const registry: UpdateRegistry = { checkedAt: prev.checkedAt, items };
  writeUpdateRegistry(repoRoot, registry);
  return registry;
}

/**
 * Полная проверка: сбор целей (без сети) → сеть → слияние → свежие версии и
 * дата проверки в реестре.
 */
export async function checkUpdateRegistry(repoRoot: string): Promise<UpdateRegistry> {
  const targets = await collectUpdateTargets(repoRoot);
  const registry = syncUpdateRegistry(repoRoot, targets);
  const latest = await fetchLatestVersions(targets);
  for (const target of targets) {
    const item = registry.items[target.id];
    const version = latest.get(target.id) ?? null;
    if (version !== null) item.latestVersion = version;
    item.updateAvailable = Boolean(
      item.latestVersion && item.currentVersion && item.latestVersion !== item.currentVersion,
    );
  }
  registry.checkedAt = new Date().toISOString();
  writeUpdateRegistry(repoRoot, registry);
  return registry;
}

/** Статусы запуска обновления по результатам шагов job'а (stepId = id записи). */
export function applyUpdateResults(repoRoot: string, results: ToolJobStepResult[]): void {
  if (results.length === 0) return;
  const registry = readUpdateRegistry(repoRoot);
  const at = new Date().toISOString();
  let changed = false;
  for (const result of results) {
    const item = result.stepId ? registry.items[result.stepId] : undefined;
    if (!item) continue;
    item.lastUpdateStatus = result.exitCode === 0 ? "success" : "error";
    item.lastUpdateAt = at;
    changed = true;
  }
  if (changed) writeUpdateRegistry(repoRoot, registry);
}

/* ------------------------------- запуск job'а ------------------------------- */

/** Шаги обновления по выбранным идентификаторам (только записи с командой). */
export function buildUpdateSteps(
  repoRoot: string,
  ids: string[],
): { ok: true; steps: ToolJobStep[] } | { ok: false; error: string } {
  const registry = readUpdateRegistry(repoRoot);
  const steps: ToolJobStep[] = [];
  for (const id of ids) {
    const item = registry.items[id];
    if (!item?.command) continue;
    steps.push({
      stepId: id,
      label: `Обновление: ${item.name}`,
      command: item.command,
      ...(item.cwd ? { cwd: item.cwd } : {}),
      // независимые пакеты: неудача одного не останавливает остальные
      optional: true,
    });
  }
  if (steps.length === 0) return { ok: false, error: "у выбранных записей нет команд обновления" };
  return { ok: true, steps };
}

/* ---------------------------------- DTO ------------------------------------- */

export function updateRegistryDTO(registry: UpdateRegistry): UpdateRegistryDTO {
  const items = Object.values(registry.items);
  const byName = (a: RegistryItem, b: RegistryItem): number => a.name.localeCompare(b.name);
  return {
    checkedAt: registry.checkedAt,
    local: items.filter((item) => item.group === "local").sort(byName),
    global: items.filter((item) => item.group === "global").sort(byName),
  };
}

/* --------------------- системные команды (литеральные argv) ------------------ */

/**
 * Версия системного бинарника из фиксированного набора (`<bin> --version`).
 * Имя программы и аргументы - литералы (без конкатенации и оболочки).
 * Вывод нормализуется: "uv 0.12.21 (Homebrew …)" → "0.12.21", "rtk 0.50.0" → "0.50.0".
 * Версию node этот helper не даёт: литеральный spawnSync("node", …) Turbopack
 * трактует как запуск модуля (резолвит "--version") - см. nodeVersion().
 */
function cliVersion(bin: "bun" | "uv" | "rtk"): string | null {
  const res = (() => {
    switch (bin) {
      case "bun":
        return spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 5000 });
      case "uv":
        return spawnSync("uv", ["--version"], { encoding: "utf8", timeout: 5000 });
      case "rtk":
        return spawnSync("rtk", ["--version"], { encoding: "utf8", timeout: 5000 });
    }
  })();
  if (res.status !== 0 || !res.stdout.trim()) return null;
  let version = res.stdout.trim().split("\n")[0] ?? "";
  if (version.startsWith(`${bin} `)) version = version.slice(bin.length + 1);
  version = version.replace(/\s+\([^)]*\)\s*$/, "").replace(/^v/, "");
  return version || null;
}

/** Версия node - из process.version (консоль и есть node-процесс; без спавна). */
function nodeVersion(): string | null {
  const version = (process.version ?? "").replace(/^v/, "");
  return version || null;
}

/** Вывод `uv tool list` (пустая строка - команда не выполнима). */
function uvToolListOutput(): string {
  const res = spawnSync("uv", ["tool", "list"], { encoding: "utf8", timeout: 15_000 });
  return res.status === 0 ? res.stdout : "";
}

/** Вывод `brew outdated --json=v2` (пустая строка - команда не выполнима). */
function brewOutdatedJson(): string {
  const res = spawnSync("brew", ["outdated", "--json=v2"], { encoding: "utf8", timeout: 60_000 });
  return res.status === 0 ? res.stdout : "";
}

/**
 * Формула установлена через brew (непустой вывод `brew list --versions`).
 * Аргумент ограничен формулами harness - фиксированный набор выше.
 */
function brewOwnedFormula(formula: "uv" | "node" | "rtk"): boolean {
  const res = spawnSync("brew", ["list", "--versions", formula], { encoding: "utf8", timeout: 15_000 });
  return res.status === 0 && res.stdout.trim().length > 0;
}

/** Обновление локального индекса brew (без него outdated показывает старое); сбой не критичен. */
function brewUpdateQuiet(): boolean {
  return spawnSync("brew", ["update", "--quiet"], { encoding: "utf8", timeout: 120_000 }).status === 0;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
