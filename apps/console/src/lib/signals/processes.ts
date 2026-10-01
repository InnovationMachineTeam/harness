import { spawnSync } from "node:child_process";
import type { ProcessInfo } from "@/core/types";

/**
 * Общий снапшот `ps` с TTL: один вызов на цикл проба вместо спавна на каждый
 * рантайм. fresh=true принудительно обновляет (используется перед сигналами
 * процессам, чтобы не убить переиспользованный PID).
 */

export interface PsInfoFull extends ProcessInfo {
  ppid: number;
  uptime: string;
  cpu: number;
  mem: number;
  kind: "app" | "cli";
}

const PS_TTL_MS = 2_000;
let psSnapshot: { at: number; stdout: string } | null = null;

function psOutput(fresh = false): string {
  if (!fresh && psSnapshot && Date.now() - psSnapshot.at < PS_TTL_MS) {
    return psSnapshot.stdout;
  }
  const res = spawnSync("ps", ["axo", "pid=,ppid=,etime=,pcpu=,pmem=,command="], {
    encoding: "utf8",
    timeout: 5000,
  });
  const stdout = res.error || res.status !== 0 ? "" : res.stdout;
  psSnapshot = { at: Date.now(), stdout };
  return stdout;
}

/** Сброс кеша ps (тесты). */
export function resetPsCache(): void {
  psSnapshot = null;
}

/** Разбор строки `ps axo pid=,ppid=,etime=,pcpu=,pmem=,command=`. Чистая функция. */
export function parsePsLine(line: string): PsInfoFull | null {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+([0-9:,-]+)\s+([0-9.]+)\s+([0-9.]+)\s+(.*)$/);
  if (!m) return null;
  const command = m[6].trim();
  if (!command) return null;
  return {
    pid: Number(m[1]),
    ppid: Number(m[2]),
    uptime: m[3],
    cpu: Number(m[4]),
    mem: Number(m[5]),
    command,
    kind: command.includes(".app/") ? "app" : "cli",
  };
}

function fromSnapshot(fresh: boolean): PsInfoFull[] {
  return psOutput(fresh)
    .split("\n")
    .map(parsePsLine)
    .filter((p): p is PsInfoFull => p !== null && p.pid !== process.pid);
}

/** Процессы рантайма (лёгкий формат ProcessInfo) - для проба активности. */
export function scanProcessesSync(pattern: RegExp): ProcessInfo[] {
  return fromSnapshot(false)
    .filter((p) => pattern.test(p.command))
    .slice(0, 12)
    .map((p) => ({ pid: p.pid, command: p.command.slice(0, 120) }));
}

export async function scanProcesses(pattern: RegExp): Promise<ProcessInfo[]> {
  return scanProcessesSync(pattern);
}

/** Расширенный список процессов рантайма (uptime/cpu/mem/kind) - вкладка "Процессы". */
export function listProcesses(pattern: RegExp): PsInfoFull[] {
  return fromSnapshot(false)
    .filter((p) => pattern.test(p.command))
    .slice(0, 40);
}

/** Свежая (без кеша) проверка, что PID существует и матчит паттерн. */
export function verifyPidFresh(pid: number, pattern: RegExp): PsInfoFull | null {
  return fromSnapshot(true).find((p) => p.pid === pid && pattern.test(p.command)) ?? null;
}
