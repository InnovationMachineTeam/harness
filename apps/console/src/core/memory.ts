import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadVendorConfigs } from "@/core/registry";
import { claudeProjectSlug } from "@/core/sessions/claude";
import type { FileEntry, FsSignalHelpers, RuntimeAdapter } from "@/core/types";

/**
 * Память консоли: документы рабочих папок (вкладка Docs), вики OpenWiki
 * (openwiki/ внутри папки) и memory-файлы рантаймов (~/.claude/projects/<slug>/memory,
 * ~/.codex/memories). Всё читается с диска; никаких собственных хранилищ.
 */

/* ------------------------------ дерево навигации ----------------------------- */

/** Узел дерева файлов: папка (с children) или файл. */
export interface NavNode {
  name: string;
  /** Абсолютный путь. */
  path: string;
  kind: "dir" | "file";
  mtime?: string;
  children?: NavNode[];
}

/** Плоский список файлов → дерево по relPath (папки first, алфавит внутри уровня). */
export function buildNavTree(root: string, files: FileEntry[]): NavNode[] {
  const rootChildren: NavNode[] = [];
  const dirs = new Map<string, NavNode>([
    ["", { name: "", path: root, kind: "dir", children: rootChildren }],
  ]);
  for (const file of files) {
    const parts = file.relPath.split("/");
    let parent = dirs.get("")!;
    let acc = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      let node = dirs.get(acc);
      if (!node) {
        node = { name: parts[i], path: path.join(root, acc), kind: "dir", children: [] };
        dirs.set(acc, node);
        parent.children!.push(node);
      }
      parent = node;
    }
    parent.children!.push({
      name: parts.at(-1)!,
      path: file.path,
      kind: "file",
      mtime: file.mtime.toISOString(),
    });
  }
  const sort = (nodes: NavNode[]) => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    for (const node of nodes) if (node.children) sort(node.children);
  };
  sort(rootChildren);
  return rootChildren;
}

/* ---------------------------------- доки ----------------------------------- */

export const DOC_MATCH = (name: string): boolean => /\.(md|markdown|mdx)$/i.test(name);

/** Markdown-документы рабочей папки в глубину (walk пропускает скрытые/node_modules). */
export async function collectDocFiles(fs: FsSignalHelpers, dir: string): Promise<FileEntry[]> {
  return fs.collectFiles(dir, { match: DOC_MATCH, maxDepth: 8, limit: 500, scanLimit: 5000 });
}

/* ----------------------------- память рантаймов ----------------------------- */

/** Подгруппа памяти: рабочая папка или "Глобальные" (вне рабочих папок). */
export interface MemorySource {
  /** Подпись подгруппы (путь рабочей папки или "Глобальные"). */
  label: string;
  /** Рабочая папка, к которой относится источник; null - глобальные. */
  workspaceDir: string | null;
  root: string;
  files: FileEntry[];
}

export interface RuntimeMemory {
  id: string;
  displayName: string;
  /** Есть ли у рантайма файловая память, которую консоль умеет показывать. */
  supported: boolean;
  /** Пояснение для UI: почему источников нет/мало. */
  note?: string;
  sources: MemorySource[];
}

const UNSUPPORTED_NOTES: Record<string, string> = {
  cursor: "память хранится в SQLite (state.vscdb) и консолью не читается",
};

/**
 * Memory-файлы рантаймов для рабочих папок (+ глобальные). Сегодня файловую
 * память пишут Claude (~/.claude/projects/<slug>/memory + ~/.claude/CLAUDE.md)
 * и Codex (~/.codex/memories; sqlite-хранилище не читается).
 */
export async function runtimeMemory(
  repoRoot: string,
  home: string,
  fs: FsSignalHelpers,
  dirs: string[],
  adapters: Record<string, RuntimeAdapter>,
  only?: string[],
): Promise<RuntimeMemory[]> {
  const vendors = await loadVendorConfigs(repoRoot);
  const ids = vendors.map((v) => v.id ?? "?").filter((id) => !only || only.includes(id));
  return Promise.all(ids.map((id) => runtimeMemoryFor(id, home, fs, dirs, adapters)));
}

async function runtimeMemoryFor(
  id: string,
  home: string,
  fs: FsSignalHelpers,
  dirs: string[],
  adapters: Record<string, RuntimeAdapter>,
): Promise<RuntimeMemory> {
  const displayName = adapters[id]?.displayName ?? id;
  if (id === "claude") {
    const sources: MemorySource[] = [];
    for (const dir of dirs) {
      const root = path.join(home, ".claude", "projects", claudeProjectSlug(dir), "memory");
      if (!(await fs.exists(root))) continue;
      sources.push({
        label: dir,
        workspaceDir: dir,
        root,
        files: await fs.collectFiles(root, { match: DOC_MATCH, maxDepth: 2, limit: 200, scanLimit: 1000 }),
      });
    }
    const globalPath = path.join(home, ".claude", "CLAUDE.md");
    const mtime = await fs.mtimeOf(globalPath);
    if (mtime) {
      sources.push({
        label: "Глобальные",
        workspaceDir: null,
        root: globalPath,
        files: [{ path: globalPath, relPath: "CLAUDE.md", name: "CLAUDE.md", mtime }],
      });
    }
    return { id, displayName, supported: true, sources };
  }
  if (id === "codex") {
    const root = path.join(home, ".codex", "memories");
    const sources: MemorySource[] = [];
    if (await fs.exists(root)) {
      sources.push({
        label: "Глобальные",
        workspaceDir: null,
        root,
        files: await fs.collectFiles(root, { maxDepth: 2, limit: 200, scanLimit: 1000 }),
      });
    }
    const empty = sources.length > 0 && sources[0].files.length === 0;
    return {
      id,
      displayName,
      supported: true,
      sources,
      note: empty ? "каталог памяти пуст; часть памяти Codex хранит в SQLite и консолью не читается" : undefined,
    };
  }
  return {
    id,
    displayName,
    supported: false,
    note: UNSUPPORTED_NOTES[id] ?? "файловая память не обнаружена",
    sources: [],
  };
}

/* --------------------------------- OpenWiki --------------------------------- */

export const WIKI_DIRNAME = "openwiki";
/** Потолок размера читаемого файла (защита от гигантских логов/дампов). */
export const MAX_READ_BYTES = 1_048_576;

export function wikiDir(workspaceDir: string): string {
  return path.join(workspaceDir, WIKI_DIRNAME);
}

/** Метаданные запуска сборки, который консоль сама спавнит (openwiki --init/--update). */
export interface WikiBuildMeta {
  pid: number;
  startedAt: string;
  mode: "init" | "update";
}

export async function readBuildMeta(workspaceDir: string): Promise<WikiBuildMeta | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(workspaceDir, WIKI_DIRNAME, ".console-build.json"), "utf8"),
    ) as Partial<WikiBuildMeta>;
    if (typeof raw.pid !== "number" || (raw.mode !== "init" && raw.mode !== "update")) return null;
    return { pid: raw.pid, startedAt: raw.startedAt ?? "", mode: raw.mode };
  } catch {
    return null;
  }
}

/** Запущен ли процесс (kill(pid, 0)); EPERM трактуем как "запущен, но чужой". */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface WikiStatus {
  /** Каталог openwiki/ существует. */
  exists: boolean;
  /** Дерево вики без dot-файлов (.claims, .run.json, .console-build.*). */
  tree: NavNode[];
  pageCount: number;
  /** Дата генерации из openwiki/.last-update.json, если есть. */
  lastUpdate: string | null;
  build: { running: boolean; mode: WikiBuildMeta["mode"] | null; startedAt: string | null; logTail: string };
}

/** Статус вики папки: дерево страниц, отметка обновления, идущая сборка. */
export async function wikiStatus(fs: FsSignalHelpers, workspaceDir: string): Promise<WikiStatus> {
  const root = wikiDir(workspaceDir);
  const meta = await readBuildMeta(workspaceDir);
  const build = {
    running: meta ? processAlive(meta.pid) : false,
    mode: meta?.mode ?? null,
    startedAt: meta?.startedAt ?? null,
    logTail: await fs.readLastChunk(path.join(root, ".console-build.log"), 2000),
  };
  if (!(await fs.exists(root))) {
    return { exists: false, tree: [], pageCount: 0, lastUpdate: null, build };
  }
  const files = await fs.collectFiles(root, {
    match: (name) => !name.startsWith("."),
    maxDepth: 6,
    limit: 500,
    scanLimit: 3000,
  });
  let lastUpdate: string | null = null;
  try {
    const raw = JSON.parse(await readFile(path.join(root, ".last-update.json"), "utf8")) as {
      generated?: unknown;
      at?: unknown;
    };
    lastUpdate = typeof raw.generated === "string" ? raw.generated : typeof raw.at === "string" ? raw.at : null;
  } catch {
    /* метки обновления нет - не страшно */
  }
  return { exists: true, tree: buildNavTree(root, files), pageCount: files.length, lastUpdate, build };
}

let cliCache: { at: number; installed: boolean; version: string | null } | null = null;

/** Сброс кеша CLI-проверки (тесты). */
export function resetWikiCliCache(): void {
  cliCache = null;
}

/** Установлен ли openwiki CLI (поиск в PATH; у CLI нет стабильного --version). */
export async function openwikiCli(): Promise<{ installed: boolean; version: string | null }> {
  if (cliCache && Date.now() - cliCache.at < 60_000) {
    return { installed: cliCache.installed, version: cliCache.version };
  }
  const which = spawnSync("which", ["openwiki"], { encoding: "utf8", timeout: 3000 });
  const installed = which.status === 0 && which.stdout.trim().length > 0;
  let version: string | null = null;
  if (installed) {
    // отсутствие --version не делает установленный CLI "не установленным"
    const v = spawnSync("openwiki", ["--version"], { encoding: "utf8", timeout: 3000 });
    if (v.status === 0 && v.stdout.trim()) version = v.stdout.trim().split("\n")[0];
  }
  cliCache = { at: Date.now(), version, installed };
  return { installed, version };
}

export interface WikiBuildResult {
  ok: boolean;
  mode: "init" | "update" | null;
  detail: string;
}

/**
 * Запустить сборку вики в папке: `openwiki --init` (нет openwiki/index.md)
 * или `--update`. Процесс отвязанный, вывод - в openwiki/.console-build.log,
 * pid/режим - в openwiki/.console-build.json. Оболочка не привлекается,
 * пользовательский ввод в команду не попадает. extraEnv - переменные
 * LLM-провайдера (state.openwikiLlm → core/openwikiLlm.ts).
 */
export async function startWikiBuild(
  workspaceDir: string,
  extraEnv: Record<string, string> = {},
): Promise<WikiBuildResult> {
  const root = wikiDir(workspaceDir);
  let mode: WikiBuildMeta["mode"] = "init";
  try {
    if ((await stat(path.join(root, "index.md"))).isFile()) mode = "update";
  } catch {
    /* index.md нет - инициализируем */
  }
  await mkdir(root, { recursive: true });
  const logFile = path.join(root, ".console-build.log");
  const fh = await open(logFile, "a");
  // вики harness ведётся на русском: флаг языка + инструкция модели
  const args = ["--language", "ru", mode === "init" ? "--init" : "--update", "Веди вики на русском языке."];
  const child = spawn("openwiki", args, {
    cwd: workspaceDir,
    env: { ...process.env, ...extraEnv },
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  });
  child.on("error", () => {
    /* ENOENT: CLI пропал между проверкой и спавном - статус сборки это покажет */
  });
  child.unref();
  const meta: WikiBuildMeta = { pid: child.pid ?? -1, startedAt: new Date().toISOString(), mode };
  await writeFile(path.join(root, ".console-build.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fh.close();
  return { ok: true, mode, detail: `сборка ${mode} запущена (PID ${child.pid ?? "?"}); лог: ${logFile}` };
}

/* ------------------------------- визуализатор ------------------------------- */

const VISUALIZER_DIRNAME = ".visualizer";

/** Файлы статического визуализатора openwiki - фиксированный набор, ничего кроме него не отдаётся. */
export const VISUALIZER_FILES: readonly string[] = [
  "index.html",
  "client.js",
  "client-lib.js",
  "styles.css",
  "graph.json",
];

const VISUALIZER_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function visualizerDir(workspaceDir: string): string {
  return path.join(workspaceDir, WIKI_DIRNAME, VISUALIZER_DIRNAME);
}

/** Стабильный слаг папки для URL визуализатора: пути не передаются через роут. */
export function visualizerSlug(workspaceDir: string): string {
  return createHash("sha256").update(workspaceDir).digest("hex").slice(0, 12);
}

/** Разрешённый файл визуализатора по сегментам URL или null (index.html по умолчанию). */
export function resolveVisualizerFile(segments: string[] | undefined): string | null {
  const name = !segments || segments.length === 0 ? "index.html" : segments.join("/");
  return VISUALIZER_FILES.includes(name) ? name : null;
}

const SLUG_RE = /^[0-9a-f]{12}$/;

/**
 * Публикация экспорта: 5 файлов фиксированного набора из
 * <dir>/openwiki/.visualizer копируются в public/visualizers/<slug>/, откуда
 * Next раздаёт их статикой - без динамических роутов и путей пользователя
 * в URL. Возвращает slug или null (экспорта ещё нет).
 */
export async function syncVisualizerPublic(
  workspaceDir: string,
  publicRoot: string,
): Promise<string | null> {
  const sourceRootReal = await realpath(visualizerDir(workspaceDir)).catch(() => null);
  if (!sourceRootReal) return null;
  const slug = visualizerSlug(workspaceDir);
  if (!SLUG_RE.test(slug)) return null;
  const targetDir = path.join(publicRoot, slug);
  await mkdir(targetDir, { recursive: true });
  for (const name of VISUALIZER_FILES) {
    await copyFile(path.join(sourceRootReal, name), path.join(targetDir, name)).catch(() => {
      /* файла нет - iframe покажет 404, лечится кнопкой "Обновить" */
    });
  }
  return slug;
}

/** Убрать из public слаги, которые больше не соответствуют рабочим папкам с экспортом. */
export async function pruneVisualizerPublic(
  publicRoot: string,
  activeSlugs: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(publicRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const active = new Set(activeSlugs);
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG_RE.test(entry.name) || active.has(entry.name)) continue;
    await rm(path.join(publicRoot, entry.name), { recursive: true, force: true });
  }
}

export function visualizerContentType(fileName: string): string {
  return VISUALIZER_CONTENT_TYPES[path.extname(fileName)] ?? "application/octet-stream";
}

export interface VisualizerStatus {
  exists: boolean;
  /** graph.json старее самого свежего *.md вики - граф можно обновить. */
  stale: boolean;
  generatedAt: string | null;
  slug: string;
}

/** Статус статического визуализатора для папки (граф генерируется без LLM). */
export async function visualizerStatus(
  fs: FsSignalHelpers,
  workspaceDir: string,
): Promise<VisualizerStatus> {
  const slug = visualizerSlug(workspaceDir);
  const graphMtime = await fs.mtimeOf(path.join(visualizerDir(workspaceDir), "graph.json"));
  if (!graphMtime) {
    return { exists: false, stale: false, generatedAt: null, slug };
  }
  const newestPage = await fs.newestMtime(path.join(workspaceDir, WIKI_DIRNAME), {
    match: (name) => name.endsWith(".md"),
    maxDepth: 6,
    scanLimit: 3000,
  });
  const stale = !newestPage || newestPage.at.getTime() > graphMtime.getTime();
  return { exists: true, stale, generatedAt: graphMtime.toISOString(), slug };
}

export interface VisualizerExportResult {
  ok: boolean;
  detail: string;
}

/**
 * Статический визуализатор: `openwiki visualize openwiki --export <dir>`.
 * Литеральная команда (без оболочки), генерация чисто локальная и мгновенная -
 * без LLM и сетевых вызовов.
 */
export function exportVisualizer(workspaceDir: string): VisualizerExportResult {
  const outDir = visualizerDir(workspaceDir);
  const res = spawnSync("openwiki", ["visualize", "openwiki", "--export", outDir], {
    cwd: workspaceDir,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (res.error) {
    return { ok: false, detail: `openwiki CLI недоступен: ${res.error.message}` };
  }
  if (res.status !== 0) {
    const tail = (res.stderr ?? "").trim().split("\n").slice(-3).join("\n");
    return { ok: false, detail: tail || `openwiki visualize завершился с кодом ${res.status}` };
  }
  const lastLine = (res.stdout ?? "").trim().split("\n").slice(-1)[0] ?? "";
  return { ok: true, detail: lastLine || `визуализатор экспортирован: ${outDir}` };
}

/* -------------------------- безопасное чтение файлов ------------------------- */

export interface ReadPolicy {
  /** Корни, внутри которых можно читать только markdown (*.md рабочей папки). */
  markdownRoots: string[];
  /** Корни, внутри которых можно читать любые недот-файлы (вики, memory-каталоги). */
  openRoots: string[];
  /** Отдельные разрешённые файлы (глобальная память рантаймов). */
  extraFiles: string[];
}

export type ReadCheck = { ok: true } | { ok: false; reason: string };

/**
 * Политика чтения для текущего состояния: доки (*.md) рабочих папок, их вики
 * openwiki/, memory-каталоги рантаймов и одиночные глобальные файлы.
 */
export function readPolicy(home: string, dirs: string[]): ReadPolicy {
  const memoryRoots = [
    ...dirs.map((dir) => path.join(home, ".claude", "projects", claudeProjectSlug(dir), "memory")),
    path.join(home, ".codex", "memories"),
  ];
  return {
    markdownRoots: dirs,
    openRoots: [...dirs.map((dir) => wikiDir(dir)), ...memoryRoots],
    extraFiles: [path.join(home, ".claude", "CLAUDE.md")],
  };
}

function underRoot(real: string, rootReal: string): boolean {
  return real === rootReal || real.startsWith(`${rootReal}/`);
}

/** Есть ли в пути относительно корня скрытая компонента (/.env, /.git/...). */
function hasDotComponent(real: string, rootReal: string): boolean {
  const rel = real === rootReal ? "" : real.slice(rootReal.length + 1);
  return rel.split("/").some((seg) => seg.startsWith("."));
}

/**
 * Разрешён ли файл к чтению: точное лексическое совпадение пути, realpath-контейн
 * внутри разрешённых корней, запрет скрытых компонент, потолок размера.
 */
export async function checkReadPath(absPath: string, policy: ReadPolicy): Promise<ReadCheck> {
  if (!path.isAbsolute(absPath)) return { ok: false, reason: "путь должен быть абсолютным" };
  if (path.resolve(absPath) !== absPath) return { ok: false, reason: "некорректный путь" };
  let real: string;
  try {
    real = await realpath(absPath);
  } catch {
    return { ok: false, reason: "файл не найден" };
  }
  const realMdRoots = await Promise.all(policy.markdownRoots.map((r) => realpath(r).catch(() => null)));
  const realOpenRoots = await Promise.all(policy.openRoots.map((r) => realpath(r).catch(() => null)));
  const realExtra = await Promise.all(policy.extraFiles.map((f) => realpath(f).catch(() => null)));

  // openRoots первым: вики/memory-корни вложены в рабочие папки, но читаются шире
  let allowed = false;
  for (const rootReal of realOpenRoots) {
    if (!rootReal || !underRoot(real, rootReal)) continue;
    if (hasDotComponent(real, rootReal)) return { ok: false, reason: "скрытые файлы не читаются" };
    allowed = true;
    break;
  }
  if (!allowed) {
    for (const rootReal of realMdRoots) {
      if (!rootReal || !underRoot(real, rootReal)) continue;
      if (hasDotComponent(real, rootReal)) return { ok: false, reason: "скрытые файлы не читаются" };
      if (!DOC_MATCH(path.basename(real))) {
        return { ok: false, reason: "в рабочих папках можно читать только markdown-документы" };
      }
      allowed = true;
      break;
    }
  }
  if (!allowed && realExtra.some((f) => f === real)) allowed = true;
  if (!allowed) return { ok: false, reason: "путь вне разрешённых корней памяти" };

  try {
    const s = await stat(real);
    if (!s.isFile()) return { ok: false, reason: "это не файл" };
    if (s.size > MAX_READ_BYTES) return { ok: false, reason: "файл больше 1 МБ" };
  } catch {
    return { ok: false, reason: "файл не найден" };
  }
  return { ok: true };
}

export type ReadFileResult =
  | { ok: true; content: string; sizeBytes: number }
  | { ok: false; reason: string };

/** Прочитать файл с проверкой политики (checkReadPath + readFile). */
export async function readAllowedFile(absPath: string, policy: ReadPolicy): Promise<ReadFileResult> {
  const check = await checkReadPath(absPath, policy);
  if (!check.ok) return check;
  try {
    const content = await readFile(absPath, "utf8");
    return { ok: true, content, sizeBytes: Buffer.byteLength(content, "utf8") };
  } catch {
    return { ok: false, reason: "не удалось прочитать файл" };
  }
}
