import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

/**
 * Статистика использования инструментов - отдельный файл
 * .agents/console/tools-usage.json: события консоли (установка/удаление/
 * вкл-выкл/сборка графов) + снапшоты внешних метрик (rtk gain, headroom
 * savings). Серверных HTTP-запросов к локальным дашбордам нет - только
 * CLI и файлы; запущенные дашборды открываются iframe из браузера.
 */

export type UsageAction =
  | "install"
  | "uninstall"
  | "reinstall"
  | "toggle"
  | "build"
  | "graph"
  | "index"
  | "pm"
  | "diagnose";

export interface UsageEvent {
  tool: string;
  action: UsageAction;
  at: string;
  runtimes?: string[];
  detail?: string;
}

export interface UsageSnapshot {
  tool: string;
  source: "rtk-cli" | "headroom-file" | "headroom-cli";
  at: string;
  /** Свободная форма: rtk - {gain…}, headroom - {savings…}. */
  payload: Record<string, unknown> | null;
}

interface UsageFile {
  events: UsageEvent[];
  snapshots: UsageSnapshot[];
}

const MAX_EVENTS = 1000;
const SNAPSHOT_TTL_MS = 5 * 60_000;

export function usageFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "tools-usage.json");
}

async function readUsageFile(repoRoot: string): Promise<UsageFile> {
  try {
    const raw = JSON.parse(await readFile(usageFilePath(repoRoot), "utf8")) as Partial<UsageFile>;
    return {
      events: Array.isArray(raw.events) ? raw.events : [],
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    };
  } catch {
    return { events: [], snapshots: [] };
  }
}

async function writeUsageFile(repoRoot: string, data: UsageFile): Promise<void> {
  const file = usageFilePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** Записать событие (append; хвост обрезается до MAX_EVENTS). */
export async function appendUsageEvent(
  repoRoot: string,
  event: Omit<UsageEvent, "at"> & { at?: string },
): Promise<void> {
  const data = await readUsageFile(repoRoot);
  data.events.push({ ...event, at: event.at ?? new Date().toISOString() });
  if (data.events.length > MAX_EVENTS) data.events = data.events.slice(-MAX_EVENTS);
  await writeUsageFile(repoRoot, data);
}

/** Агрегация по инструментам для UI: сколько событий и когда последнее. */
export function aggregateUsage(events: UsageEvent[]): Record<
  string,
  { total: number; lastAt: string | null; byAction: Record<string, number> }
> {
  const acc: Record<string, { total: number; lastAt: string | null; byAction: Record<string, number> }> = {};
  for (const event of events) {
    const bucket = (acc[event.tool] ??= { total: 0, lastAt: null, byAction: {} });
    bucket.total += 1;
    bucket.byAction[event.action] = (bucket.byAction[event.action] ?? 0) + 1;
    if (!bucket.lastAt || event.at > bucket.lastAt) bucket.lastAt = event.at;
  }
  return acc;
}

/* --------------------------- внешние метрики (CLI/файлы) --------------------- */

function rtkSnapshot(): UsageSnapshot | null {
  const which = spawnSync("which", ["rtk"], { encoding: "utf8", timeout: 3000 });
  if (which.status !== 0) return null;
  const res = spawnSync("rtk", ["gain", "--format", "json", "--all"], { encoding: "utf8", timeout: 10_000 });
  if (res.status !== 0 || !res.stdout.trim()) return null;
  try {
    return { tool: "rtk", source: "rtk-cli", at: new Date().toISOString(), payload: JSON.parse(res.stdout) };
  } catch {
    return null;
  }
}

function headroomSnapshot(): UsageSnapshot | null {
  const file = path.join(homedir(), ".headroom", "proxy_savings.json");
  if (existsSync(file)) {
    try {
      return {
        tool: "headroom",
        source: "headroom-file",
        at: new Date().toISOString(),
        payload: JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>,
      };
    } catch {
      /* повреждённый файл - пробуем CLI */
    }
  }
  const which = spawnSync("which", ["headroom"], { encoding: "utf8", timeout: 3000 });
  if (which.status !== 0) return null;
  const res = spawnSync("headroom", ["savings"], { encoding: "utf8", timeout: 10_000 });
  if (res.status !== 0 || !res.stdout.trim()) return null;
  return {
    tool: "headroom",
    source: "headroom-cli",
    at: new Date().toISOString(),
    payload: { text: res.stdout.trim().slice(0, 4000) },
  };
}

/**
 * События + свежие снапшоты внешних метрик (не чаще раза в SNAPSHOT_TTL_MS:
 * свежие не перезапрашиваются, берутся из файла).
 */
export async function collectUsage(repoRoot: string): Promise<{
  events: UsageEvent[];
  aggregates: Record<string, { total: number; lastAt: string | null; byAction: Record<string, number> }>;
  snapshots: UsageSnapshot[];
}> {
  const data = await readUsageFile(repoRoot);
  const now = Date.now();
  let changed = false;
  for (const make of [rtkSnapshot, headroomSnapshot]) {
    const key = make === rtkSnapshot ? "rtk" : "headroom";
    const existing = data.snapshots.find((s) => s.tool === key);
    if (existing && now - Date.parse(existing.at) < SNAPSHOT_TTL_MS) continue;
    const fresh = make();
    if (fresh) {
      data.snapshots = [...data.snapshots.filter((s) => s.tool !== key), fresh];
      changed = true;
    }
  }
  if (changed) await writeUsageFile(repoRoot, data);
  return { events: data.events.slice(-200), aggregates: aggregateUsage(data.events), snapshots: data.snapshots };
}
