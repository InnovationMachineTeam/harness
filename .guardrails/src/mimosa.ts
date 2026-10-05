import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Записи статусов хук-событий в .mimosa/hook-status/ по схеме
// mimosa-hook-status/v1 - vendor-нейтральный признак guard-активности,
// который читает дашборд консоли. Запись best-effort: сбой записи
// никогда не влияет на решение хука.

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

export function writeHookStatus(repoRoot: string, record: MimosaHookStatus): void {
  try {
    const dir = join(repoRoot, ".mimosa", "hook-status");
    mkdirSync(dir, { recursive: true });
    const sessionId = record.sessionId.startsWith("sess_") ? record.sessionId : `sess_${record.sessionId}`;
    const suffix = randomBytes(5).toString("hex");
    const file = join(dir, `${sessionId}-${suffix}.json`);
    writeFileSync(file, JSON.stringify(mimosaStatusDocument(record)) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {
    // Статус не критичен для решения; сбой записи игнорируется.
  }
}
