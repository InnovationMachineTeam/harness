import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Записи статусов хук-событий в .mimosa/hook-status/ по схеме
// mimosa-hook-status/v1 - vendor-нейтральный признак guard-активности,
// который читает дашборд консоли. Запись best-effort: сбой записи
// никогда не влияет на решение хука. Каталог ограничен по возрасту
// (24 ч) и числу файлов (500): обрезка выполняется при записи,
// полный обход - только когда файлов больше предела.

export type MimosaOutcome = "clear" | "warn" | "blocked";

export interface MimosaHookStatus {
  /** Идентификатор сессии рантайма; с префиксом sess_ или без. */
  sessionId: string;
  event: string;
  toolName?: string;
  file?: string;
  outcome: MimosaOutcome;
  findingCount: number;
  durationMs: number;
  coverage?: "complete" | "partial";
  reportHint?: string;
}

export function mimosaStatusDocument(record: MimosaHookStatus, recordedAt = new Date().toISOString()): Record<string, unknown> {
  const sessionId = record.sessionId.startsWith("sess_") ? record.sessionId : `sess_${record.sessionId}`;
  return {
    schemaVersion: "mimosa-hook-status/v1",
    recordedAt,
    sessionId,
    event: record.event,
    ...(record.toolName ? { toolName: record.toolName } : {}),
    ...(record.file ? { file: record.file } : {}),
    outcome: record.outcome,
    coverage: record.coverage ?? "complete",
    findingCount: record.findingCount,
    durationMs: record.durationMs,
    hostState: "hook_complete",
    reportHint: record.reportHint ?? ".guardrails/audit/events.jsonl",
  };
}

/** Пределы хранения статусов: возраст записи и число файлов. */
export const HOOK_STATUS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const HOOK_STATUS_MAX_FILES = 500;

/** Удаляет просроченные записи; при превышении предела - старейшие сверх лимита. */
export function pruneHookStatus(dir: string, now = Date.now()): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  if (entries.length <= HOOK_STATUS_MAX_FILES) return;
  const cutoff = now - HOOK_STATUS_MAX_AGE_MS;
  const kept: Array<{ file: string; mtime: number }> = [];
  for (const name of entries) {
    const file = join(dir, name);
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime < cutoff) { try { unlinkSync(file); } catch {} continue; }
      kept.push({ file, mtime });
    } catch { continue; }
  }
  if (kept.length <= HOOK_STATUS_MAX_FILES) return;
  kept.sort((a, b) => a.mtime - b.mtime);
  for (const item of kept.slice(0, kept.length - HOOK_STATUS_MAX_FILES)) {
    try { unlinkSync(item.file); } catch {}
  }
}

export function writeHookStatus(repoRoot: string, record: MimosaHookStatus): void {
  try {
    const dir = join(repoRoot, ".mimosa", "hook-status");
    mkdirSync(dir, { recursive: true });
    const sessionId = record.sessionId.startsWith("sess_") ? record.sessionId : `sess_${record.sessionId}`;
    const suffix = randomBytes(5).toString("hex");
    const file = join(dir, `${sessionId}-${suffix}.json`);
    writeFileSync(file, JSON.stringify(mimosaStatusDocument(record)) + "\n", { encoding: "utf8", mode: 0o600 });
    pruneHookStatus(dir);
  } catch {
    // Статус не критичен для решения; сбой записи игнорируется.
  }
}
