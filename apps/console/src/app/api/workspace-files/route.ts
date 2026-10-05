import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace-files?cwd=<dir>&path=<подпапка>&q=<подстрока> - файлы и
 * папки рабочей папки для @-упоминаний в промте. Без q - один уровень
 * (подпапка из path); с q - рекурсивный поиск файлов по подстроке имени.
 * Пути не выходят за пределы cwd; служебные каталоги исключены.
 */

/** Лимиты листинга и поиска. */
const MAX_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_DEPTH = 8;

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".nx", ".next", ".turbo", "dist", "build", "out",
  "coverage", ".venv", "venv", "__pycache__", ".cache", "graphify-out",
  ".codegraph", ".serena", ".agents", ".zcode", ".claude", ".codex", ".cursor",
]);

interface DirEntryDTO {
  name: string;
  /** Путь относительно cwd (с "src/"-стилем разделителей). */
  relPath: string;
  dir: boolean;
}

function isInsideCwd(target: string, cwd: string): boolean {
  const resolved = path.resolve(target);
  return resolved === path.resolve(cwd) || resolved.startsWith(path.resolve(cwd) + path.sep);
}

export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const cwd = params.get("cwd")?.trim() || ctx.repoRoot;
  if (cwd !== ctx.repoRoot && !workspaceDirs(ctx.state).includes(cwd)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }
  const subPath = params.get("path")?.replace(/^\/+/, "") ?? "";
  const query = params.get("q")?.trim().toLowerCase() ?? "";
  const base = path.resolve(cwd, subPath);
  if (!isInsideCwd(base, cwd)) {
    return NextResponse.json({ error: "путь вне рабочей папки" }, { status: 400 });
  }

  try {
    if (!query) {
      const entries = await readdir(base, { withFileTypes: true });
      const items: DirEntryDTO[] = [];
      for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        // Скрытые файлы и каталоги (dot-префикс) не показываются в списке @.
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
        if (items.length >= MAX_ENTRIES) break;
        items.push({ name: entry.name, relPath: subPath ? `${subPath}/${entry.name}` : entry.name, dir: entry.isDirectory() });
      }
      return NextResponse.json({ cwd, path: subPath, items });
    }

    const results: DirEntryDTO[] = [];
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (results.length >= MAX_SEARCH_RESULTS || depth > MAX_SEARCH_DEPTH) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        // Скрытые записи не ищутся и не обходятся.
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.has(entry.name)) continue;
          const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
          // папки участвуют в поиске: клик по ним - навигация внутрь
          if (entry.name.toLowerCase().includes(query)) {
            results.push({ name: entry.name, relPath: entryRel, dir: true });
          }
          await walk(path.join(dir, entry.name), entryRel, depth + 1);
          continue;
        }
        if (!entry.name.toLowerCase().includes(query)) continue;
        results.push({ name: entry.name, relPath: rel ? `${rel}/${entry.name}` : entry.name, dir: false });
      }
    };
    await walk(base, subPath, 1);
    return NextResponse.json({ cwd, path: subPath, q: params.get("q"), items: results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
