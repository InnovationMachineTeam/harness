import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FsSignalHelpers } from "./types";
import { processAlive } from "./memory";

/**
 * Graphify во вкладке "Память" - зеркало механики OpenWiki (core/memory.ts):
 * детект CLI → отвязанная сборка графа (graphify extract/update) с pid-метой и
 * логом → публикация graph.html статикой в public/graphify/<slug>/ → iframe.
 * Граф пишется в <dir>/graphify-out/ (graph.json + graph.html + отчёт).
 */

export const GRAPHIFY_OUT = "graphify-out";
/** Потолок чтения graph.json для счётчиков узлов/рёбер (файл может быть большим). */
const GRAPH_JSON_LIMIT = 8 * 1024 * 1024;

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

/**
 * Запустить сборку графа: `graphify extract .` (graphify-out/graph.json нет)
 * или `graphify update .`. Процесс отвязанный, вывод - в
 * graphify-out/.console-build.log, pid/режим - в .console-build.json.
 * extraEnv - переменные LLM-бэкенда (state.graphifyLlm).
 */
export async function startGraphifyBuild(
  workspaceDir: string,
  extraEnv: Record<string, string> = {},
): Promise<GraphifyBuildResult> {
  const root = graphifyOutDir(workspaceDir);
  let mode: GraphifyBuildMeta["mode"] = "init";
  try {
    if ((await stat(path.join(root, "graph.json"))).isFile()) mode = "update";
  } catch {
    /* графа ещё нет - инициализируем */
  }
  await mkdir(root, { recursive: true });
  const logFile = path.join(root, ".console-build.log");
  const fh = await open(logFile, "a");
  const child = spawn("graphify", [mode === "init" ? "extract" : "update", "."], {
    cwd: workspaceDir,
    env: { ...process.env, ...extraEnv },
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
      const parsed = JSON.parse(await readFile(graphPath, "utf8")) as {
        nodes?: unknown[];
        edges?: unknown[];
      };
      nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : null;
      edges = Array.isArray(parsed.edges) ? parsed.edges.length : null;
    }
  } catch {
    /* повреждённый или слишком большой JSON - счётчики неизвестны */
  }
  return { exists: true, nodes, edges, lastBuild: graphStat.mtime.toISOString(), build };
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
 * граф с того же origin. vis-network грузится с CDN unpkg: просмотр требует
 * интернета, генерация локальна.
 */
export async function syncGraphifyPublic(workspaceDir: string, publicRoot: string): Promise<string | null> {
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
  return slug;
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
