import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileEntry, FsSignalHelpers } from "@/core/types";

/** Каталоги, которые не обходим при поиске файлов-сигналов. */
const SKIP_DIRS = new Set([".git", "node_modules", ".nx", ".next"]);

async function walk(
  current: string,
  relBase: string,
  depth: number,
  maxDepth: number,
  match: (name: string) => boolean,
  out: FileEntry[],
  budget: { scanLimit: number; visited: number },
): Promise<void> {
  if (budget.visited >= budget.scanLimit) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.visited >= budget.scanLimit) return;
    // сам корень обхода может быть скрытым (~/.claude и т.п.) - это не мешает;
    // внутри пропускаем только скрытые и служебные каталоги, файлы не фильтруем
    if (entry.isDirectory() && (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name))) continue;
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      if (depth >= maxDepth) continue;
      await walk(abs, join(relBase, entry.name), depth + 1, maxDepth, match, out, budget);
    } else if (entry.isFile() && match(entry.name)) {
      budget.visited += 1;
      try {
        const s = await stat(abs);
        out.push({ path: abs, relPath: join(relBase, entry.name), name: entry.name, mtime: s.mtime });
      } catch {
        /* файл исчез между readdir и stat - пропускаем */
      }
    }
  }
}

/**
 * Файлы каталога (рекурсивно, с ограничением глубины), отсортированные по mtime
 * по убыванию. scanLimit ограничивает число осмотренных файлов: эвристике
 * "свежий след" достаточно приближения, а обход огромных каталогов (~/.cursor
 * с extensions) не должен съедать секунды.
 */
async function collectFiles(
  dir: string,
  opts: { match?: (name: string) => boolean; maxDepth?: number; limit?: number; scanLimit?: number } = {},
): Promise<FileEntry[]> {
  const { match = () => true, maxDepth = 4, limit = 200, scanLimit = 2000 } = opts;
  const out: FileEntry[] = [];
  await walk(dir, "", 0, maxDepth, match, out, { scanLimit, visited: 0 });
  out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return out.slice(0, limit);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function mtimeOf(path: string): Promise<Date | null> {
  try {
    const s = await stat(path);
    return s.mtime;
  } catch {
    return null;
  }
}

async function newestMtime(
  dir: string,
  opts: { match?: (name: string) => boolean; maxDepth?: number; scanLimit?: number } = {},
): Promise<{ at: Date; source: string } | null> {
  const files = await collectFiles(dir, { ...opts, limit: 1 });
  const top = files[0];
  return top ? { at: top.mtime, source: top.relPath } : null;
}

/**
 * Первая строка файла как JSON-объект (для peek `cwd` в rollout-файлах Codex).
 * Читается не более 4 КБ; при любой ошибке - null.
 */
async function headJsonLine(path: string): Promise<Record<string, unknown> | null> {
  // первая строка может быть длинной (session_meta у Codex ~22 КБ) - берём с запасом
  const text = await readFirstChunk(path, 32_000);
  if (text === "") return null;
  try {
    const parsed = JSON.parse(text.split("\n", 1)[0]);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readText(path: string, maxBytes = 8192): Promise<string | null> {
  const chunk = await readFirstChunk(path, maxBytes);
  return chunk === "" ? null : chunk;
}

async function readLastChunk(path: string, maxBytes = 8192): Promise<string> {
  let fh;
  try {
    fh = await open(path, "r");
    const size = (await fh.stat()).size;
    const len = Math.min(maxBytes, size);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    await fh?.close().catch(() => {});
  }
}

async function readFirstChunk(path: string, maxBytes = 4096): Promise<string> {
  let fh;
  try {
    fh = await open(path, "r");
    const size = (await fh.stat()).size;
    const len = Math.min(maxBytes, size);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    await fh?.close().catch(() => {});
  }
}

export const fsSignals: FsSignalHelpers = {
  exists,
  mtimeOf,
  collectFiles,
  newestMtime,
  headJsonLine,
  readText,
  readLastChunk,
  readFirstChunk,
};

/** Абсолютный путь → путь с ~ для отображения в UI. */
export function tilde(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** Установлен ли рантайм: существует ли хоть один из маркеров установки. */
export async function anyExists(paths: string[]): Promise<boolean> {
  const results = await Promise.all(paths.map((p) => exists(p)));
  return results.some(Boolean);
}
