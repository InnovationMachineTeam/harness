import { mkdirSync } from "node:fs";
import path from "node:path";
import { openSqliteDb, type WorkflowDb } from "@/core/workflows/storage";

/**
 * Хранилище индекса сессий - файл .agents/console/sessions.sqlite.
 * Аккумулирует историю сессий всех рантаймов (по модели agentsview):
 * метрики (токены, стоимость, длительность, инструменты) и тексты сообщений
 * для полнотекстового поиска (FTS5; при отсутствии FTS5 в сборке SQLite -
 * поиск LIKE). Инкрементальность сбора - байтовые курсоры в самой БД
 * (sync_cursors), запись дельт идёт поверх существующих строк (UPSERT).
 */

/** Дельта одной сессии за один проход сбора (парсер рантайма). */
export interface SessionDelta {
  runtime: string;
  sessionId: string;
  workspaceDir?: string | null;
  projectDir?: string | null;
  title?: string | null;
  startedAt?: string | null;
  /** Свежесть: максимум из времён событий и mtime файла. */
  lastActivityAt: string;
  sizeBytes?: number;
  models?: string[];
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  /** Стоимость дельты, USD (0 - цена модели неизвестна). */
  costUsd: number;
  /** Токены дельты, покрытые ценой каталога (для взвешенного покрытия). */
  pricedTokens: number;
  turns: number;
  /** Новые сообщения дельты (пишутся при включённом contentSearch). */
  messages: { role: "user" | "assistant" | "system"; at?: string; text: string }[];
  /** Счётчики вызовов инструментов дельты. */
  tools: Record<string, number>;
  filePath?: string | null;
}

/** Итог одного прохода сбора по всем источникам. */
export interface CollectOutcome {
  sessions: SessionDelta[];
  /** Дневные дельты токенов/стоимости; ключ "<runtime>|<YYYY-MM-DD>". */
  days: Record<string, { inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number }>;
  /** Дневные дельты вызовов инструментов; ключ "<runtime>|<day>|<tool>". */
  tools: Record<string, number>;
  /** Новые позиции чтения файлов (байтовые офсеты). */
  cursors: Record<string, number>;
  /** Дополнительное состояние курсора (JSON): кумулятивы codex, rowid opencode. */
  cursorMeta: Record<string, string>;
}

/** Строка сессии из индекса. */
export interface SessionIndexRow {
  runtime: string;
  sessionId: string;
  workspaceDir: string | null;
  projectDir: string | null;
  title: string | null;
  startedAt: string | null;
  lastActivityAt: string;
  durationMs: number;
  turns: number;
  sizeBytes: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  pricingCoverage: number;
  messageCount: number;
  toolCount: number;
  filePath: string | null;
}

/** Хит поиска: сообщение со сниппетом + метаданные сессии. */
export interface SessionSearchHit {
  runtime: string;
  sessionId: string;
  title: string | null;
  workspaceDir: string | null;
  role: string;
  at: string | null;
  snippet: string;
}

/** Сессия с числом вызовов инструмента (для детализации). */
export interface SessionToolUsage extends SessionIndexRow {
  toolCalls: number;
}

/** Архетип сессии по длительности. */
export interface DurationBucket {
  key: "quick" | "standard" | "deep" | "marathon";
  count: number;
  tokens: number;
  costUsd: number;
}

const SCHEMA_DDL = [
  "CREATE TABLE IF NOT EXISTS sessions (runtime TEXT NOT NULL, session_id TEXT NOT NULL, workspace_dir TEXT, project_dir TEXT, title TEXT, started_at TEXT, last_activity_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0, models_json TEXT NOT NULL DEFAULT '[]', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0, cost_value REAL NOT NULL DEFAULT 0, pricing_coverage REAL NOT NULL DEFAULT 0, message_count INTEGER NOT NULL DEFAULT 0, tool_count INTEGER NOT NULL DEFAULT 0, file_path TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (runtime, session_id))",
  "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity_at)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_dir)",
  "CREATE TABLE IF NOT EXISTS session_days (day TEXT NOT NULL, runtime TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0, cost_value REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, runtime))",
  "CREATE TABLE IF NOT EXISTS tool_usage (day TEXT NOT NULL, runtime TEXT NOT NULL, tool TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, runtime, tool))",
  "CREATE TABLE IF NOT EXISTS session_tools (runtime TEXT NOT NULL, session_id TEXT NOT NULL, tool TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (runtime, session_id, tool))",
  "CREATE TABLE IF NOT EXISTS session_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, runtime TEXT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL, at TEXT, text TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session ON session_messages(runtime, session_id, id)",
  "CREATE TABLE IF NOT EXISTS sync_cursors (key TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, meta_json TEXT, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

/** Внешний содержимый FTS5-индекс по session_messages (rowid = id). */
const FTS_DDL = [
  "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='session_messages', content_rowid='id')",
  "CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON session_messages BEGIN INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text); END",
  "CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON session_messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text); END",
];

interface SessionDbRow {
  runtime: string;
  session_id: string;
  workspace_dir: string | null;
  project_dir: string | null;
  title: string | null;
  started_at: string | null;
  last_activity_at: string;
  duration_ms: number;
  turns: number;
  size_bytes: number;
  models_json: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost_value: number;
  pricing_coverage: number;
  message_count: number;
  tool_count: number;
  file_path: string | null;
}

function toIsoOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function durationBetween(startedAt: string | null, lastActivityAt: string | null): number {
  if (!startedAt || !lastActivityAt) return 0;
  const ms = new Date(lastActivityAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function rowToSession(row: SessionDbRow): SessionIndexRow {
  let models: string[] = [];
  try {
    const parsed = JSON.parse(row.models_json) as unknown;
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string");
  } catch {
    /* повреждённый JSON - пустой список */
  }
  return {
    runtime: row.runtime,
    sessionId: row.session_id,
    workspaceDir: row.workspace_dir,
    projectDir: row.project_dir,
    title: row.title,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    durationMs: row.duration_ms,
    turns: row.turns,
    sizeBytes: row.size_bytes,
    models,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheTokens: row.cache_tokens,
    costUsd: row.cost_value,
    pricingCoverage: row.pricing_coverage,
    messageCount: row.message_count,
    toolCount: row.tool_count,
    filePath: row.file_path,
  };
}

/** Экранирование LIKE-шаблона (% и _). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Запрос FTS: каждое слово - фраза в кавычках, неявное AND; устойчиво к синтаксису ввода. */
export function ftsQuery(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
}

export class SessionIndexStore {
  readonly db: WorkflowDb;
  readonly file: string;
  /** FTS5 доступен в этой сборке SQLite (проверяется при открытии). */
  readonly ftsEnabled: boolean;

  constructor(repoRoot: string) {
    this.file = path.join(repoRoot, ".agents", "console", "sessions.sqlite");
    mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = openSqliteDb(this.file);
    for (const statement of SCHEMA_DDL) this.db.prepare(statement).run();
    this.ftsEnabled = this.detectFts();
  }

  private detectFts(): boolean {
    try {
      for (const statement of FTS_DDL) this.db.prepare(statement).run();
      // FTS-таблица появилась позже накопленных сообщений (другая сборка SQLite,
      // переустановка) - единовременная перестройка индекса из session_messages
      const rebuilt = this.getMeta("fts_rebuilt");
      if (!rebuilt) {
        const { total, indexed } = this.db
          .prepare("SELECT (SELECT COUNT(*) FROM session_messages) AS total, (SELECT COUNT(*) FROM messages_fts) AS indexed")
          .get() as { total: number; indexed: number };
        if (total > 0 && indexed === 0) this.db.prepare("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')").run();
        this.setMeta("fts_rebuilt", new Date().toISOString());
      }
      return true;
    } catch {
      // нет FTS5 в сборке - поиск работает LIKE-фолбэком по session_messages
      try {
        this.db.prepare("DROP TRIGGER IF EXISTS messages_fts_insert").run();
        this.db.prepare("DROP TRIGGER IF EXISTS messages_fts_delete").run();
        this.db.prepare("DROP TABLE IF EXISTS messages_fts").run();
      } catch {
        /* опционально */
      }
      return false;
    }
  }

  close(): void {
    this.db.close();
  }

  /* ------------------------------- запись ------------------------------- */

  /** Применить итог сбора одной транзакцией: дельты сессий, дни, инструменты, курсоры. */
  applyCollect(outcome: CollectOutcome, options: { contentSearch: boolean }): void {
    const now = new Date().toISOString();
    const write = this.db.transaction(() => {
      for (const delta of outcome.sessions) this.applySessionDelta(delta, options.contentSearch, now);
      for (const [key, day] of Object.entries(outcome.days)) {
        const [runtime, dayKey] = splitDayKey(key);
        if (!runtime || !dayKey) continue;
        this.db
          .prepare(
            "INSERT INTO session_days (day, runtime, input_tokens, output_tokens, cache_tokens, cost_value) VALUES (?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT(day, runtime) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cache_tokens = cache_tokens + excluded.cache_tokens, cost_value = cost_value + excluded.cost_value",
          )
          .run(dayKey, runtime, day.inputTokens, day.outputTokens, day.cacheTokens, day.costUsd);
      }
      for (const [key, calls] of Object.entries(outcome.tools)) {
        const [runtime, dayKey, tool] = splitToolKey(key);
        if (!runtime || !dayKey || !tool) continue;
        this.db
          .prepare(
            "INSERT INTO tool_usage (day, runtime, tool, calls) VALUES (?, ?, ?, ?) " +
              "ON CONFLICT(day, runtime, tool) DO UPDATE SET calls = calls + excluded.calls",
          )
          .run(dayKey, runtime, tool, calls);
      }
      for (const [key, cursor] of Object.entries(outcome.cursors)) {
        this.db
          .prepare(
            "INSERT INTO sync_cursors (key, cursor, meta_json, updated_at) VALUES (?, ?, ?, ?) " +
              "ON CONFLICT(key) DO UPDATE SET cursor = excluded.cursor, meta_json = COALESCE(excluded.meta_json, sync_cursors.meta_json), updated_at = excluded.updated_at",
          )
          .run(key, cursor, outcome.cursorMeta[key] ?? null, now);
      }
      this.setMeta("last_sync_at", now);
    });
    write();
  }

  private applySessionDelta(delta: SessionDelta, contentSearch: boolean, now: string): void {
    const prev = this.db
      .prepare("SELECT * FROM sessions WHERE runtime = ? AND session_id = ?")
      .get(delta.runtime, delta.sessionId) as SessionDbRow | undefined;

    const prevTokens = prev ? prev.input_tokens + prev.output_tokens + prev.cache_tokens : 0;
    const deltaTokens = delta.inputTokens + delta.outputTokens + delta.cacheTokens;
    const totalTokens = prevTokens + deltaTokens;
    const prevPriced = prev ? Math.round(prev.pricing_coverage * prevTokens) : 0;
    const pricedTokens = prevPriced + delta.pricedTokens;

    const startedAt = prev ? minIso(prev.started_at, toIsoOrNull(delta.startedAt)) : toIsoOrNull(delta.startedAt);
    const lastActivityAt = maxIso(prev?.last_activity_at ?? null, delta.lastActivityAt) ?? now;
    const models = mergeModels(prev?.models_json, delta.models);
    const toolCount = (prev?.tool_count ?? 0) + Object.values(delta.tools).reduce((sum, n) => sum + n, 0);

    const row = {
      runtime: delta.runtime,
      sessionId: delta.sessionId,
      workspaceDir: delta.workspaceDir ?? prev?.workspace_dir ?? null,
      projectDir: delta.projectDir ?? prev?.project_dir ?? null,
      title: prev?.title ?? (delta.title ?? null),
      startedAt,
      lastActivityAt,
      durationMs: durationBetween(startedAt, lastActivityAt),
      turns: (prev?.turns ?? 0) + delta.turns,
      sizeBytes: Math.max(prev?.size_bytes ?? 0, delta.sizeBytes ?? 0),
      modelsJson: JSON.stringify(models),
      inputTokens: (prev?.input_tokens ?? 0) + delta.inputTokens,
      outputTokens: (prev?.output_tokens ?? 0) + delta.outputTokens,
      cacheTokens: (prev?.cache_tokens ?? 0) + delta.cacheTokens,
      costValue: (prev?.cost_value ?? 0) + delta.costUsd,
      pricingCoverage: totalTokens > 0 ? Math.min(1, pricedTokens / totalTokens) : 0,
      messageCount: (prev?.message_count ?? 0) + delta.messages.length,
      toolCount,
      filePath: delta.filePath ?? prev?.file_path ?? null,
    };

    this.db
      .prepare(
        "INSERT INTO sessions (runtime, session_id, workspace_dir, project_dir, title, started_at, last_activity_at, duration_ms, turns, size_bytes, models_json, input_tokens, output_tokens, cache_tokens, cost_value, pricing_coverage, message_count, tool_count, file_path, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(runtime, session_id) DO UPDATE SET workspace_dir = excluded.workspace_dir, project_dir = excluded.project_dir, title = excluded.title, started_at = excluded.started_at, last_activity_at = excluded.last_activity_at, duration_ms = excluded.duration_ms, turns = excluded.turns, size_bytes = excluded.size_bytes, models_json = excluded.models_json, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, cache_tokens = excluded.cache_tokens, cost_value = excluded.cost_value, pricing_coverage = excluded.pricing_coverage, message_count = excluded.message_count, tool_count = excluded.tool_count, file_path = excluded.file_path, updated_at = excluded.updated_at",
      )
      .run(
        row.runtime,
        row.sessionId,
        row.workspaceDir,
        row.projectDir,
        row.title,
        row.startedAt,
        row.lastActivityAt,
        row.durationMs,
        row.turns,
        row.sizeBytes,
        row.modelsJson,
        row.inputTokens,
        row.outputTokens,
        row.cacheTokens,
        row.costValue,
        row.pricingCoverage,
        row.messageCount,
        row.toolCount,
        row.filePath,
        now,
      );

    if (contentSearch && delta.messages.length > 0) {
      const insert = this.db.prepare("INSERT INTO session_messages (runtime, session_id, role, at, text) VALUES (?, ?, ?, ?, ?)");
      for (const message of delta.messages) insert.run(delta.runtime, delta.sessionId, message.role, message.at ?? null, message.text);
    }
    // инструменты сессии: дельты вызовов суммируются с существующими
    if (delta.tools && Object.keys(delta.tools).length > 0) {
      const upsertTool = this.db.prepare(
        "INSERT INTO session_tools (runtime, session_id, tool, calls) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(runtime, session_id, tool) DO UPDATE SET calls = calls + excluded.calls",
      );
      for (const [tool, calls] of Object.entries(delta.tools)) upsertTool.run(delta.runtime, delta.sessionId, tool, calls);
    }
  }

  /* ------------------------------- чтение ------------------------------- */

  /** Список сессий индекса; dir фильтрует по рабочей папке или папке проекта. */
  listSessions(filter: { runtime?: string; dir?: string; since?: string; limit?: number }): SessionIndexRow[] {
    const conditions = ["1 = 1"];
    const params: unknown[] = [];
    if (filter.runtime) {
      conditions.push("runtime = ?");
      params.push(filter.runtime);
    }
    if (filter.dir) {
      conditions.push("(workspace_dir = ? OR project_dir = ?)");
      params.push(filter.dir, filter.dir);
    }
    if (filter.since) {
      conditions.push("last_activity_at >= ?");
      params.push(filter.since);
    }
    params.push(filter.limit ?? 500);
    const rows = this.db
      .prepare(`SELECT * FROM sessions WHERE ${conditions.join(" AND ")} ORDER BY last_activity_at DESC LIMIT ?`)
      .all(...params) as SessionDbRow[];
    return rows.map(rowToSession);
  }

  /** Метрики одной сессии; null - сессии нет в индексе. */
  getSession(runtime: string, sessionId: string): SessionIndexRow | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE runtime = ? AND session_id = ?").get(runtime, sessionId) as
      | SessionDbRow
      | undefined;
    return row ? rowToSession(row) : null;
  }

  /**
   * Полнотекстовый поиск по сообщениям (FTS5, ранжирование) или LIKE-фолбэк;
   * фильтры runtime/dir применяются после сопоставления с sessions.
   */
  search(query: string, filter: { runtime?: string; dir?: string; limit?: number }): { fts: boolean; hits: SessionSearchHit[] } {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { fts: this.ftsEnabled, hits: [] };
    const limit = filter.limit ?? 50;
    const candidateLimit = limit * 4;
    const sessionFilter = this.sessionFilterSql(filter, "s");
    const fts = this.ftsEnabled
      ? this.searchFts(trimmed, sessionFilter, candidateLimit)
      : this.searchLike(trimmed, sessionFilter, candidateLimit);
    const seen = new Set<string>();
    const hits: SessionSearchHit[] = [];
    for (const hit of fts) {
      const key = `${hit.runtime}:${hit.sessionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= limit) break;
    }
    return { fts: this.ftsEnabled, hits };
  }

  private sessionFilterSql(filter: { runtime?: string; dir?: string }, alias: string): { sql: string; params: unknown[] } {
    const conditions = ["1 = 1"];
    const params: unknown[] = [];
    if (filter.runtime) {
      conditions.push(`${alias}.runtime = ?`);
      params.push(filter.runtime);
    }
    if (filter.dir) {
      conditions.push(`(${alias}.workspace_dir = ? OR ${alias}.project_dir = ?)`);
      params.push(filter.dir, filter.dir);
    }
    return { sql: conditions.join(" AND "), params };
  }

  private searchFts(query: string, sessionFilter: { sql: string; params: unknown[] }, limit: number): SessionSearchHit[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT m.runtime, m.session_id, m.role, m.at, snippet(messages_fts, 0, '[', ']', '…', 16) AS snippet, s.title, s.workspace_dir ` +
            `FROM messages_fts JOIN session_messages m ON m.id = messages_fts.rowid JOIN sessions s ON s.runtime = m.runtime AND s.session_id = m.session_id ` +
            `WHERE messages_fts MATCH ? AND ${sessionFilter.sql} ORDER BY rank LIMIT ?`,
        )
        .all(ftsQuery(query), ...sessionFilter.params, limit) as Array<{
        runtime: string;
        session_id: string;
        role: string;
        at: string | null;
        snippet: string;
        title: string | null;
        workspace_dir: string | null;
      }>;
      return rows.map((row) => ({
        runtime: row.runtime,
        sessionId: row.session_id,
        title: row.title,
        workspaceDir: row.workspace_dir,
        role: row.role,
        at: row.at,
        snippet: row.snippet,
      }));
    } catch {
      // неподдерживаемый запрос (например, одиночные CJK-символы в некоторых сборках) - LIKE-фолбэк
      return this.searchLike(query, sessionFilter, limit);
    }
  }

  private searchLike(query: string, sessionFilter: { sql: string; params: unknown[] }, limit: number): SessionSearchHit[] {
    const pattern = `%${escapeLike(query)}%`;
    const rows = this.db
      .prepare(
        `SELECT m.runtime, m.session_id, m.role, m.at, substr(m.text, 1, 200) AS snippet, s.title, s.workspace_dir ` +
          `FROM session_messages m JOIN sessions s ON s.runtime = m.runtime AND s.session_id = m.session_id ` +
          `WHERE m.text LIKE ? ESCAPE '\\' AND ${sessionFilter.sql} ORDER BY m.id DESC LIMIT ?`,
      )
      .all(pattern, ...sessionFilter.params, limit) as Array<{
      runtime: string;
      session_id: string;
      role: string;
      at: string | null;
      snippet: string;
      title: string | null;
      workspace_dir: string | null;
    }>;
    return rows.map((row) => ({
      runtime: row.runtime,
      sessionId: row.session_id,
      title: row.title,
      workspaceDir: row.workspace_dir,
      role: row.role,
      at: row.at,
      snippet: row.snippet,
    }));
  }

  /** Поиск по метаданным (заголовок, папки) - работает без contentSearch. */
  searchMeta(query: string, filter: { runtime?: string; dir?: string; limit?: number }): SessionIndexRow[] {
    const pattern = `%${escapeLike(query.trim())}%`;
    if (pattern === "%%") return [];
    const sessionFilter = this.sessionFilterSql(filter, "sessions");
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions WHERE (title LIKE ? ESCAPE '\\' OR workspace_dir LIKE ? ESCAPE '\\' OR project_dir LIKE ? ESCAPE '\\') AND ${sessionFilter.sql} ORDER BY last_activity_at DESC LIMIT ?`,
      )
      .all(pattern, pattern, pattern, ...sessionFilter.params, filter.limit ?? 50) as SessionDbRow[];
    return rows.map(rowToSession);
  }

  /** Дневной ряд для heatmap: sessions - счётчики сессий, tokens/cost - дельты из session_days. */
  heatmapDays(metric: "sessions" | "tokens" | "cost", sinceIso: string): { date: string; total: number }[] {
    if (metric === "sessions") {
      const rows = this.db
        .prepare(
          "SELECT COALESCE(substr(started_at, 1, 10), substr(last_activity_at, 1, 10)) AS day, COUNT(*) AS n FROM sessions WHERE COALESCE(started_at, last_activity_at) >= ? GROUP BY day",
        )
        .all(sinceIso) as Array<{ day: string; n: number }>;
      return rows.map((row) => ({ date: row.day, total: row.n })).sort((a, b) => a.date.localeCompare(b.date));
    }
    const column = metric === "tokens" ? "(input_tokens + output_tokens + cache_tokens)" : "cost_value";
    const rows = this.db
      .prepare(`SELECT day, SUM(${column}) AS total FROM session_days WHERE day >= ? GROUP BY day`)
      .all(sinceIso.slice(0, 10)) as Array<{ day: string; total: number }>;
    return rows
      .map((row) => ({ date: row.day, total: metric === "tokens" ? row.total : Math.round(row.total * 10000) / 10000 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Сводные метрики за период (last_activity_at >= since). */
  summary(sinceIso: string): {
    count: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    costUsd: number;
    avgDurationMs: number;
    topProjects: { dir: string; sessions: number; tokens: number; costUsd: number }[];
    toolMix: { tool: string; calls: number }[];
    archetypes: DurationBucket[];
  } {
    const totals = this.db
      .prepare(
        "SELECT COUNT(*) AS count, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_tokens), 0) AS cache_tokens, COALESCE(SUM(cost_value), 0) AS cost_value, COALESCE(AVG(NULLIF(duration_ms, 0)), 0) AS avg_duration FROM sessions WHERE last_activity_at >= ?",
      )
      .get(sinceIso) as { count: number; input_tokens: number; output_tokens: number; cache_tokens: number; cost_value: number; avg_duration: number };
    const projects = this.db
      .prepare(
        "SELECT COALESCE(workspace_dir, project_dir, '(без папки)') AS dir, COUNT(*) AS sessions, SUM(input_tokens + output_tokens + cache_tokens) AS tokens, SUM(cost_value) AS cost FROM sessions WHERE last_activity_at >= ? GROUP BY dir ORDER BY tokens DESC LIMIT 10",
      )
      .all(sinceIso) as Array<{ dir: string; sessions: number; tokens: number; cost: number }>;
    const tools = this.db
      .prepare("SELECT tool, SUM(calls) AS calls FROM tool_usage WHERE day >= ? GROUP BY tool ORDER BY calls DESC LIMIT 15")
      .all(sinceIso.slice(0, 10)) as Array<{ tool: string; calls: number }>;
    return {
      count: totals.count,
      inputTokens: totals.input_tokens,
      outputTokens: totals.output_tokens,
      cacheTokens: totals.cache_tokens,
      costUsd: Math.round(totals.cost_value * 10000) / 10000,
      avgDurationMs: Math.round(totals.avg_duration),
      topProjects: projects.map((row) => ({ dir: row.dir, sessions: row.sessions, tokens: row.tokens, costUsd: Math.round((row.cost ?? 0) * 10000) / 10000 })),
      toolMix: tools.map((row) => ({ tool: row.tool, calls: row.calls })),
      archetypes: this.durationBuckets(),
    };
  }

  /** Дневные вызовы инструментов: день, инструмент, сумма вызовов (для ряда). */
  toolDayRows(sinceDay: string): { day: string; tool: string; calls: number }[] {
    return this.db
      .prepare("SELECT day, tool, SUM(calls) AS calls FROM tool_usage WHERE day >= ? GROUP BY day, tool ORDER BY day")
      .all(sinceDay) as { day: string; tool: string; calls: number }[];
  }

  /** Архетипы сессий по длительности (сессии без длительности не учитываются). */
  durationBuckets(): DurationBucket[] {
    const rows = this.db
      .prepare(
        "SELECT CASE WHEN duration_ms <= 0 THEN 'unknown' WHEN duration_ms < 300000 THEN 'quick' WHEN duration_ms < 3600000 THEN 'standard' WHEN duration_ms < 14400000 THEN 'deep' ELSE 'marathon' END AS bucket, COUNT(*) AS count, SUM(input_tokens + output_tokens + cache_tokens) AS tokens, SUM(cost_value) AS cost " +
          "FROM sessions GROUP BY bucket",
      )
      .all() as Array<{ bucket: string; count: number; tokens: number | null; cost: number | null }>;
    const keys: DurationBucket["key"][] = ["quick", "standard", "deep", "marathon"];
    return keys.map((key) => {
      const row = rows.find((entry) => entry.bucket === key);
      return { key, count: row?.count ?? 0, tokens: row?.tokens ?? 0, costUsd: Math.round((row?.cost ?? 0) * 10000) / 10000 };
    });
  }

  /** Позиция чтения файла и дополнительное состояние курсора. */
  getCursor(key: string): { cursor: number; meta: Record<string, unknown> } {
    const row = this.db.prepare("SELECT cursor, meta_json FROM sync_cursors WHERE key = ?").get(key) as
      | { cursor: number; meta_json: string | null }
      | undefined;
    let meta: Record<string, unknown> = {};
    if (row?.meta_json) {
      try {
        const parsed = JSON.parse(row.meta_json) as unknown;
        if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
      } catch {
        /* повреждённый JSON - пустое состояние */
      }
    }
    return { cursor: row?.cursor ?? 0, meta };
  }

  /** Сессии дня (день старта или день последней активности), свежие сверху. */
  sessionsByDay(day: string, limit = 100): SessionIndexRow[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE substr(started_at, 1, 10) = ? OR substr(last_activity_at, 1, 10) = ? ORDER BY last_activity_at DESC LIMIT ?",
      )
      .all(day, day, limit) as SessionDbRow[];
    return rows.map(rowToSession);
  }

  /** Сессии с участием модели (точное совпадение элемента models_json). */
  sessionsByModel(model: string, limit = 50): SessionIndexRow[] {
    const trimmed = model.trim();
    if (!trimmed) return [];
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE models_json LIKE ? ESCAPE '\\' ORDER BY last_activity_at DESC LIMIT ?")
      .all(`%"${escapeLike(trimmed)}"%`, limit) as SessionDbRow[];
    return rows.map(rowToSession);
  }

  /** Сессии с числом вызовов инструмента. */
  sessionsByTool(tool: string, limit = 50): SessionToolUsage[] {
    const trimmed = tool.trim();
    if (!trimmed) return [];
    const rows = this.db
      .prepare(
        "SELECT s.*, st.calls AS tool_calls FROM session_tools st JOIN sessions s ON s.runtime = st.runtime AND s.session_id = st.session_id " +
          "WHERE st.tool = ? ORDER BY st.calls DESC LIMIT ?",
      )
      .all(trimmed, limit) as (SessionDbRow & { tool_calls: number })[];
    return rows.map((row) => ({ ...rowToSession(row), toolCalls: row.tool_calls }));
  }

  /** Значение из index_meta (last_sync_at и др.); null - ключа нет. */
  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM index_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}

function mergeModels(prevJson: string | undefined, deltaModels: string[] | undefined): string[] {
  const merged: string[] = [];
  const push = (model: string) => {
    if (model && !merged.includes(model) && merged.length < 8) merged.push(model);
  };
  if (prevJson) {
    try {
      const parsed = JSON.parse(prevJson) as unknown;
      if (Array.isArray(parsed)) for (const model of parsed) if (typeof model === "string") push(model);
    } catch {
      /* повреждённый JSON - начинаем с дельты */
    }
  }
  for (const model of deltaModels ?? []) push(model);
  return merged;
}

function splitDayKey(key: string): [string | null, string | null] {
  const index = key.indexOf("|");
  if (index <= 0) return [null, null];
  return [key.slice(0, index), key.slice(index + 1)];
}

function splitToolKey(key: string): [string | null, string | null, string | null] {
  const parts = key.split("|");
  if (parts.length !== 3) return [null, null, null];
  return [parts[0]!, parts[1]!, parts[2]!];
}
