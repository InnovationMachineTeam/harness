import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FsSignalHelpers } from "./types";
import { buildNavTree, processAlive, type NavNode } from "./memory";
import { saveTaskMeta } from "./tasks";

/**
 * Graphify во вкладке "Память" - зеркалом механики OpenWiki (core/memory.ts):
 * детект CLI → отвязанная сборка графа (graphify extract) с pid-метой и логом →
 * публикация graph.html статикой в public/graphify/<slug>/ → iframe.
 *
 * Графы рабочих папок собираются в хранилище воркспейсов консоли:
 * <repoRoot>/graphify/<имя>/graphify-out/ - по одному графу на папку
 * (`graphify extract <папка> --out <хранилище>`; графы разных папок не
 * смешиваются). Имя воркспейса - имя папки; при совпадении имён добавляется
 * суффикс из sha256 полного пути (graphifyWorkspaceNames).
 */

export const GRAPHIFY_OUT = "graphify-out";
/** Каталог хранилища воркспейсов в корне репозитория. */
export const GRAPHIFY_STORE = "graphify";
/** Потолок чтения graph.json для счётчиков узлов/рёбер (файл может быть большим). */
const GRAPH_JSON_LIMIT = 8 * 1024 * 1024;

/** Корень хранилища воркспейсов: <repoRoot>/graphify. */
export function graphifyStoreRoot(repoRoot: string): string {
  return path.join(repoRoot, GRAPHIFY_STORE);
}

/**
 * Имена воркспейсов по рабочим папкам (граф папки в хранилище -
 * <repoRoot>/graphify/<имя>/graphify-out). Имя - basename папки; если basename
 * совпадает у нескольких папок, каждой добавляется суффикс "-" + 4 символа
 * sha256 полного пути (детерминированно, без состояния на диске).
 */
export function graphifyWorkspaceNames(dirs: string[]): Map<string, string> {
  const byBasename = new Map<string, string[]>();
  for (const dir of dirs) {
    const base = path.basename(dir) || "workspace";
    const list = byBasename.get(base) ?? [];
    list.push(dir);
    byBasename.set(base, list);
  }
  const names = new Map<string, string>();
  for (const [base, list] of byBasename) {
    if (list.length === 1) {
      names.set(list[0], base);
      continue;
    }
    for (const dir of [...list].sort()) {
      const suffix = createHash("sha256").update(dir).digest("hex").slice(0, 4);
      names.set(dir, `${base}-${suffix}`);
    }
  }
  return names;
}

/** Каталог воркспейса в хранилище: <repoRoot>/graphify/<имя>. */
export function graphifyWorkspaceDir(repoRoot: string, name: string): string {
  return path.join(graphifyStoreRoot(repoRoot), name);
}

/** Каталог артефактов graphify внутри воркспейса: <воркспейс>/graphify-out. */
export function graphifyOutDir(workspaceDir: string): string {
  return path.join(workspaceDir, GRAPHIFY_OUT);
}

let graphifyCliCache: { at: number; installed: boolean } | null = null;

/** Сброс кеша (тесты). */
export function resetGraphifyCliCache(): void {
  graphifyCliCache = null;
}

/** Установлен ли graphify CLI (which; стабильного --version нет). */
export function graphifyCliInstalled(): boolean {
  if (graphifyCliCache && Date.now() - graphifyCliCache.at < 60_000) return graphifyCliCache.installed;
  const which = spawnSync("which", ["graphify"], { encoding: "utf8", timeout: 3000 });
  const installed = which.status === 0 && which.stdout.trim().length > 0;
  graphifyCliCache = { at: Date.now(), installed };
  return installed;
}

/* --------------------------------- сборка ----------------------------------- */

export interface GraphifyBuildMeta {
  pid: number;
  startedAt: string;
  mode: "init" | "update";
}

export async function readGraphifyBuildMeta(workspaceDir: string): Promise<GraphifyBuildMeta | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(graphifyOutDir(workspaceDir), ".console-build.json"), "utf8"),
    ) as Partial<GraphifyBuildMeta>;
    if (typeof raw.pid !== "number" || (raw.mode !== "init" && raw.mode !== "update")) return null;
    return { pid: raw.pid, startedAt: raw.startedAt ?? "", mode: raw.mode };
  } catch {
    return null;
  }
}

export interface GraphifyBuildResult {
  ok: boolean;
  mode: "init" | "update" | null;
  detail: string;
}

export interface GraphifyBuildOptions {
  /** Рабочая папка - источник файлов для графа. */
  sourceDir: string;
  /** Каталог воркспейса в хранилище (graphifyWorkspaceDir). */
  storeDir: string;
  /** cwd процесса и база записи задачи. */
  repoRoot: string;
  extraEnv?: Record<string, string>;
  backend?: string | null;
  model?: string | null;
  /** Локальная сборка без LLM-ключа: только код (AST), doc-файлы пропускаются. */
  codeOnly?: boolean;
  task?: { model: string | null };
}

/** Аргумент командной строки в одинарных кавычках (пути с пробелами). */
function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Запустить сборку графа воркспейса: `graphify extract <sourceDir> --out
 * <storeDir>` и следом `graphify cluster-only <storeDir> --no-label`.
 * extract CLI 0.9.73 пишет только graph.json; graph.html и GRAPH_REPORT.md
 * создаёт cluster-only - без него публиковать граф нечего. --no-label
 * оставляет имена сообществ Community_N: генерация графа остаётся локальной,
 * без LLM-ключа и сети. Повторный extract инкрементален (manifest-гейт CLI:
 * неуменьшенные файлы берутся из кеша). Процесс отвязанный, вывод - в
 * graphify-out/.console-build.log, pid/режим - в .console-build.json.
 * extraEnv - переменные LLM-бэкенда (state.graphifyLlm); backend - значение
 * `--backend` (ключ из пресета не попадает в авто-детект CLI: без флага
 * doc-корпус не собирается - "no LLM API key found").
 * task - запись в реестр задач (Мониторинг → Задачи).
 */
export async function startGraphifyBuild(opts: GraphifyBuildOptions): Promise<GraphifyBuildResult> {
  const { sourceDir, storeDir, repoRoot } = opts;
  const root = graphifyOutDir(storeDir);
  let mode: GraphifyBuildMeta["mode"] = "init";
  try {
    if ((await stat(path.join(root, "graph.json"))).isFile()) mode = "update";
  } catch {
    /* графа ещё нет - инициализируем */
  }
  await mkdir(root, { recursive: true });
  const logFile = path.join(root, ".console-build.log");
  const fh = await open(logFile, "a");
  const args = ["extract", sourceDir, "--out", storeDir];
  if (opts.codeOnly) args.push("--code-only");
  if (opts.backend) args.push("--backend", opts.backend);
  // без --model CLI берёт свой дефолт (qwen2.5-coder:7b) - его может не быть в ollama
  if (opts.model) args.push("--model", opts.model);
  const chain = [
    `graphify ${args.map(shellArg).join(" ")}`,
    `graphify cluster-only ${shellArg(storeDir)} --no-label`,
  ].join(" && ");
  const child = spawn("sh", ["-c", chain], {
    cwd: repoRoot,
    env: { ...process.env, ...opts.extraEnv },
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  });
  child.on("error", () => {
    /* ENOENT: CLI пропал между проверкой и спавном - статус сборки покажет */
  });
  child.unref();
  const meta: GraphifyBuildMeta = { pid: child.pid ?? -1, startedAt: new Date().toISOString(), mode };
  await writeFile(path.join(root, ".console-build.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fh.close();
  if (opts.task) {
    await saveTaskMeta(repoRoot, {
      kind: "graphify-build",
      title: `Сборка графа Graphify (${mode})`,
      executor: { type: "tool", id: "graphify" },
      model: opts.task.model ?? null,
      pid: child.pid ?? null,
      sessionRuntime: null,
      logFile,
      detail: `${sourceDir} → ${path.relative(repoRoot, storeDir) || storeDir}`,
    }).catch(() => undefined);
  }
  return { ok: true, mode, detail: `сборка графа (${mode}) запущена (PID ${child.pid ?? "?"}); лог: ${logFile}` };
}

/* ---------------------------------- статус ---------------------------------- */

export interface GraphifyStatus {
  /** graphify-out/graph.json существует. */
  exists: boolean;
  /** Узлы/рёбра из graph.json (null - файл слишком большой для разбора). */
  nodes: number | null;
  edges: number | null;
  /** mtime graph.json - время последней сборки. */
  lastBuild: string | null;
  build: { running: boolean; mode: GraphifyBuildMeta["mode"] | null; startedAt: string | null; logTail: string };
}

export async function graphifyStatus(fs: FsSignalHelpers, workspaceDir: string): Promise<GraphifyStatus> {
  const root = graphifyOutDir(workspaceDir);
  const meta = await readGraphifyBuildMeta(workspaceDir);
  const build = {
    running: meta ? processAlive(meta.pid) : false,
    mode: meta?.mode ?? null,
    startedAt: meta?.startedAt ?? null,
    logTail: await fs.readLastChunk(path.join(root, ".console-build.log"), 2000),
  };
  const graphPath = path.join(root, "graph.json");
  let graphStat;
  try {
    graphStat = await stat(graphPath);
  } catch {
    return { exists: false, nodes: null, edges: null, lastBuild: null, build };
  }
  let nodes: number | null = null;
  let edges: number | null = null;
  try {
    if (graphStat.size <= GRAPH_JSON_LIMIT) {
      // graphify пишет node-link JSON networkx: рёбра - в поле links
      const parsed = JSON.parse(await readFile(graphPath, "utf8")) as {
        nodes?: unknown[];
        edges?: unknown[];
        links?: unknown[];
      };
      nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : null;
      if (Array.isArray(parsed.edges)) edges = parsed.edges.length;
      else if (Array.isArray(parsed.links)) edges = parsed.links.length;
    }
  } catch {
    /* повреждённый или слишком большой JSON - счётчики неизвестны */
  }
  return { exists: true, nodes, edges, lastBuild: graphStat.mtime.toISOString(), build };
}

/* ------------------------------ wiki из графа -------------------------------- */

export interface GraphifyWikiMeta {
  pid: number;
  startedAt: string;
}

export async function readGraphifyWikiMeta(workspaceDir: string): Promise<GraphifyWikiMeta | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(graphifyOutDir(workspaceDir), ".console-wiki.json"), "utf8"),
    ) as Partial<GraphifyWikiMeta>;
    if (typeof raw.pid !== "number") return null;
    return { pid: raw.pid, startedAt: raw.startedAt ?? "" };
  } catch {
    return null;
  }
}

export interface GraphifyWikiResult {
  ok: boolean;
  detail: string;
}

export interface GraphifyWikiOptions {
  /** Каталог воркспейса в хранилище (graphifyWorkspaceDir). */
  storeDir: string;
  /** cwd процесса и база записи задачи. */
  repoRoot: string;
  task?: { model: string | null };
}

/**
 * Собрать wiki из графа воркспейса: `graphify export wiki --graph
 * <storeDir>/graphify-out/graph.json`. CLI пишет статьи markdown в
 * graphify-out/wiki/ (index.md - точка входа агента); имена сообществ берутся
 * из .graphify_labels.json (появляются при полной сборке с LLM-бэкендом),
 * без них - Community_N. Процесс отвязанный, вывод - в
 * graphify-out/.console-wiki.log, pid - в .console-wiki.json.
 */
export async function startGraphifyWikiBuild(opts: GraphifyWikiOptions): Promise<GraphifyWikiResult> {
  const { storeDir, repoRoot } = opts;
  const root = graphifyOutDir(storeDir);
  await mkdir(root, { recursive: true });
  const logFile = path.join(root, ".console-wiki.log");
  const fh = await open(logFile, "a");
  const child = spawn(
    "graphify",
    ["export", "wiki", "--graph", path.join(root, "graph.json")],
    {
      cwd: repoRoot,
      env: process.env,
      detached: true,
      stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
    },
  );
  child.on("error", () => {
    /* ENOENT: CLI пропал между проверкой и спавном - статус покажет */
  });
  child.unref();
  const meta: GraphifyWikiMeta = { pid: child.pid ?? -1, startedAt: new Date().toISOString() };
  await writeFile(path.join(root, ".console-wiki.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fh.close();
  if (opts.task) {
    await saveTaskMeta(repoRoot, {
      kind: "graphify-wiki",
      title: "Сборка wiki Graphify",
      executor: { type: "tool", id: "graphify" },
      model: opts.task.model ?? null,
      pid: child.pid ?? null,
      sessionRuntime: null,
      logFile,
      detail: path.relative(repoRoot, storeDir) || storeDir,
    }).catch(() => undefined);
  }
  return { ok: true, detail: `сборка wiki запущена (PID ${child.pid ?? "?"}); лог: ${logFile}` };
}

export interface GraphifyWikiStatus {
  /** graphify-out/wiki/index.md существует. */
  exists: boolean;
  /** Число статей (.md) в wiki/ (null - wiki/ нет). */
  articles: number | null;
  /** mtime wiki/index.md - время последней сборки wiki. */
  lastBuild: string | null;
  build: { running: boolean; startedAt: string | null; logTail: string };
}

export async function graphifyWikiStatus(fs: FsSignalHelpers, workspaceDir: string): Promise<GraphifyWikiStatus> {
  const wikiDir = path.join(graphifyOutDir(workspaceDir), "wiki");
  const meta = await readGraphifyWikiMeta(workspaceDir);
  const build = {
    running: meta ? processAlive(meta.pid) : false,
    startedAt: meta?.startedAt ?? null,
    logTail: await fs.readLastChunk(path.join(graphifyOutDir(workspaceDir), ".console-wiki.log"), 2000),
  };
  let entries;
  try {
    entries = await readdir(wikiDir, { withFileTypes: true });
  } catch {
    return { exists: false, articles: null, lastBuild: null, build };
  }
  const articles = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
  const indexStat = await stat(path.join(wikiDir, "index.md")).catch(() => null);
  return {
    exists: indexStat !== null,
    articles,
    lastBuild: indexStat ? indexStat.mtime.toISOString() : null,
    build,
  };
}

/** Дерево статей wiki воркспейса (NavNode, как у OpenWiki); пустой массив - wiki нет. */
export async function graphifyWikiTree(fs: FsSignalHelpers, workspaceDir: string): Promise<NavNode[]> {
  const wikiDir = path.join(graphifyOutDir(workspaceDir), "wiki");
  if (!(await fs.exists(wikiDir))) return [];
  const files = await fs.collectFiles(wikiDir, {
    match: (name) => !name.startsWith("."),
    maxDepth: 3,
    limit: 500,
    scanLimit: 3000,
  });
  return buildNavTree(wikiDir, files);
}

/* ------------------------------- публикация графа ---------------------------- */

/** Стабильный слаг папки для URL (пути пользователя в URL не попадают). */
export function graphifySlug(workspaceDir: string): string {
  return createHash("sha256").update(workspaceDir).digest("hex").slice(0, 12);
}

const SLUG_RE = /^[0-9a-f]{12}$/;

/**
 * Публикация графа: graphify-out/graph.html копируется в
 * public/graphify/<slug>/index.html и раздаётся Next статикой - iframe строит
 * граф с того же origin. Возвращает слаг и mtime опубликованного файла
 * (ключ перезагрузки iframe); vis-network грузится с CDN unpkg: просмотр
 * требует интернета, генерация локальна.
 */
export async function syncGraphifyPublic(
  workspaceDir: string,
  publicRoot: string,
): Promise<{ slug: string; generatedAt: string } | null> {
  const source = path.join(graphifyOutDir(workspaceDir), "graph.html");
  const sourceReal = await realpath(source).catch(() => null);
  if (!sourceReal) return null;
  const slug = graphifySlug(workspaceDir);
  if (!SLUG_RE.test(slug)) return null;
  const targetDir = path.join(publicRoot, slug);
  await mkdir(targetDir, { recursive: true });
  await copyFile(sourceReal, path.join(targetDir, "index.html")).catch(() => {
    /* файла нет - iframe покажет 404, лечится пересборкой */
  });
  const targetStat = await stat(path.join(targetDir, "index.html")).catch(() => null);
  const generated = targetStat ?? (await stat(sourceReal).catch(() => null));
  if (!generated) return null;
  return { slug, generatedAt: generated.mtime.toISOString() };
}

/** Убрать из public слаги, которые больше не соответствуют активным папкам. */
export async function pruneGraphifyPublic(publicRoot: string, activeSlugs: string[]): Promise<void> {
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

export interface GraphifyPublishStatus {
  exists: boolean;
  generatedAt: string | null;
  slug: string;
}

/** Статус опубликованного графа (по mtime скопированного index.html). */
export async function graphifyPublishStatus(
  fs: FsSignalHelpers,
  workspaceDir: string,
  publicRoot: string,
): Promise<GraphifyPublishStatus> {
  const slug = graphifySlug(workspaceDir);
  const mtime = await fs.mtimeOf(path.join(publicRoot, slug, "index.html"));
  return { exists: Boolean(mtime), generatedAt: mtime ? mtime.toISOString() : null, slug };
}
