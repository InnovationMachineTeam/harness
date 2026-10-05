import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProbeContext, SessionDetail, SessionMessage, SessionSummary } from "@/core/types";

/**
 * Сессии OpenCode: SQLite-БД ~/.local/share/opencode/opencode.db, таблица
 * session хранит колонку directory - рабочую директорию сессии. Чтение
 * идёт через системный sqlite3 в режиме -readonly (WAL-БД читается при
 * работающем OpenCode, зависимостей не добавляется). Нет БД или sqlite3 -
 * пустой список: отсутствие истории не ошибка.
 */

interface SessionRow {
  id: string;
  title?: string | null;
  directory?: string | null;
  time_created?: unknown;
  time_updated?: unknown;
}

export function opencodeDbPath(home: string = homedir()): string {
  return join(home, ".local", "share", "opencode", "opencode.db");
}

/** Идентификатор сессии OpenCode: латиница, цифры, дефис, подчёркивание. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function queryRows(sql: string): Record<string, unknown>[] | null {
  const probe = spawnSync("sqlite3", ["-readonly", "-json", opencodeDbPath(), sql], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (probe.error || (probe.status !== 0 && probe.status !== null)) return null;
  try {
    const parsed = JSON.parse(probe.stdout || "[]");
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

/** Значение времени drizzle (мс) в ISO; неразбираемое - null. */
function toIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== "") return toIso(asNumber);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function normalizeDir(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.replace(/\/+$/, "");
}

function toSummary(row: SessionRow): SessionSummary | null {
  if (typeof row.id !== "string" || !row.id) return null;
  const lastActivityAt = toIso(row.time_updated) ?? toIso(row.time_created) ?? new Date(0).toISOString();
  return {
    id: row.id,
    runtime: "opencode",
    startedAt: toIso(row.time_created) ?? undefined,
    lastActivityAt,
    workspaceDir: normalizeDir(row.directory) ?? undefined,
    titleHint: typeof row.title === "string" && row.title.trim() ? row.title.slice(0, 120) : undefined,
    sizeBytes: 0,
    resumable: true,
  };
}

/** Список сессий; dirs - фильтр по рабочим директориям (пустой список - все). */
export async function listOpencodeSessions(ctx: ProbeContext, dirs: string[]): Promise<SessionSummary[]> {
  const rows = queryRows(
    "SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT 500",
  );
  if (!rows) return [];
  const wanted = dirs.map((dir) => dir.replace(/\/+$/, ""));
  const summaries = rows
    .map((raw) => toSummary(raw as unknown as SessionRow))
    .filter((item): item is SessionSummary => item !== null);
  if (wanted.length === 0) return summaries;
  return summaries.filter((item) => item.workspaceDir !== undefined && wanted.includes(item.workspaceDir));
}

/** Текстовые части записи message таблицы (схема зависит от версии OpenCode). */
function textFromMessageData(raw: unknown): { role: "user" | "assistant" | "system"; text: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as { role?: unknown; parts?: unknown; text?: unknown };
  const role = data.role === "assistant" || data.role === "system" ? data.role : "user";
  let text = "";
  if (Array.isArray(data.parts)) {
    text = data.parts
      .map((part) => {
        const item = part as { type?: unknown; text?: unknown };
        return item?.type === "text" && typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n");
  } else if (typeof data.text === "string") {
    text = data.text;
  }
  if (!text.trim()) return null;
  return { role, text: text.slice(0, 800) };
}

function excerptFromRows(rows: Record<string, unknown>[] | null): SessionMessage[] {
  if (!rows) return [];
  const out: SessionMessage[] = [];
  for (const row of rows) {
    const parsed = textFromMessageData(row.data);
    if (!parsed) continue;
    out.push({ ...parsed, ts: toIso(row.time_created) ?? undefined });
    if (out.length >= 30) break;
  }
  return out;
}

/** Детали сессии: сводка из БД + превью сообщений (best-effort по схеме message). */
export async function getOpencodeSession(ctx: ProbeContext, id: string): Promise<SessionDetail | null> {
  if (!isSafeId(id)) return null;
  const rows = queryRows(
    `SELECT id, title, directory, time_created, time_updated FROM session WHERE id = '${id}' LIMIT 1`,
  );
  const summary = rows && rows.length > 0 ? toSummary(rows[0] as unknown as SessionRow) : null;
  if (!summary) return null;
  const messages = queryRows(
    `SELECT data, time_created FROM message WHERE session_id = '${id}' ORDER BY rowid LIMIT 80`,
  );
  return {
    summary,
    excerpt: excerptFromRows(messages),
    file: "~/.local/share/opencode/opencode.db",
  };
}

/**
 * Ожидание ввода: последняя сессия рабочей папки обновлялась в окне
 * 2 минут - 6 часов назад (ход завершён, новых записей нет).
 * Живость процесса проверяет адаптер.
 */
export async function opencodeAwaiting(ctx: ProbeContext): Promise<{ sessionId: string; since: string } | null> {
  const sessions = await listOpencodeSessions(ctx, ctx.workspaces);
  const newest = sessions[0];
  if (!newest) return null;
  const age = Date.now() - new Date(newest.lastActivityAt).getTime();
  if (age < 2 * 60_000 || age > 6 * 3600_000) return null;
  return { sessionId: newest.id, since: newest.lastActivityAt };
}
