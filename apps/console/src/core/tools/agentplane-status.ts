import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Проекция AgentPlane для мониторинга; без импортов реестра инструментов (цикл импортов). */
export interface AgentPlaneProjection {
  readiness: unknown;
  activeTasks: string[];
  /** Число задач по статусам из строки "Total: N (TODO=1, ...)" вывода task list --all. */
  taskCounts: Record<string, number>;
  totalTasks: number;
  error: string | null;
}

/** cwd должен быть абсолютным путём без обхода вверх; иначе запуск идёт в cwd процесса. */
function safeCwd(cwd?: string): string | undefined {
  if (!cwd || !path.isAbsolute(cwd) || cwd.split(path.sep).includes("..")) return undefined;
  return cwd;
}

export function agentPlaneProjection(cwdInput?: string): AgentPlaneProjection {
  const cwd = safeCwd(cwdInput);
  if (!cwd || !existsSync(path.join(cwd, ".agentplane"))) {
    return { readiness: { ok: false, initialized: false }, activeTasks: [], taskCounts: {}, totalTasks: 0, error: "AgentPlane не инициализирован в workspace" };
  }
  const opts = { encoding: "utf8" as const, timeout: 5_000, env: process.env, cwd };
  const preflight = spawnSync("agentplane", ["preflight", "--json", "--mode", "quick"], opts);
  const tasks = spawnSync("agentplane", ["task", "list", "--limit", "100", "--quiet"], opts);
  const all = spawnSync("agentplane", ["task", "list", "--all"], opts);
  const counts: Record<string, number> = {};
  let totalTasks = 0;
  for (const line of String(all.stdout ?? "").split("\n")) {
    const m = line.match(/Total:\s*(\d+)\s*(?:\((.*)\))?\s*$/);
    if (!m) continue;
    totalTasks = Number.parseInt(m[1] ?? "0", 10) || 0;
    for (const pair of (m[2] ?? "").split(",")) {
      const kv = pair.match(/\s*(\S+)=(\d+)\s*/);
      if (kv) counts[kv[1]!] = Number.parseInt(kv[2]!, 10) || 0;
    }
  }
  let readiness: unknown = null;
  try { readiness = JSON.parse(preflight.stdout || "null"); } catch { readiness = { ok: false, detail: (preflight.stderr || preflight.stdout || "").trim() }; }
  return {
    readiness,
    activeTasks: tasks.status === 0 ? String(tasks.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean) : [],
    taskCounts: counts,
    totalTasks,
    error: preflight.status === 0 ? null : (preflight.stderr || "AgentPlane preflight failed").trim(),
  };
}

/** Статус для мониторинга: установка CLI + проекция задач workspace. */
export function agentPlaneStatus(cwdInput?: string): { installed: boolean; version: string | null; detail: string; projection: AgentPlaneProjection } {
  const cwd = safeCwd(cwdInput);
  const version = spawnSync("agentplane", ["--version"], { encoding: "utf8", timeout: 5_000, env: process.env, cwd });
  const installed = version.status === 0;
  return {
    installed,
    version: installed ? String(version.stdout ?? "").trim().split("\n")[0]?.slice(0, 160) || null : null,
    detail: installed ? "Готов" : "CLI agentplane не найден",
    projection: agentPlaneProjection(cwdInput),
  };
}
