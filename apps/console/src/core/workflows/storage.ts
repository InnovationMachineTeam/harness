import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { PrivacyMode, WorkflowDefinition } from "./schema";

/** Минимальный контракт драйвера: better-sqlite3 (Node, Next-роуты) и bun:sqlite (Bun, worker). */
export interface WorkflowDb {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

/**
 * Открывает SQLite-соединение под текущий рантайм. better-sqlite3 v13 не
 * загружается в Bun, поэтому worker идёт через родной bun:sqlite;
 * API-роуты Next работают в Node и используют better-sqlite3. Все запросы
 * хранилища - позиционные плейсхолдеры, контракт prepare/run/get/all/
 * transaction/close у драйверов общий. Используется и другими хранилищами
 * консоли (например, индексом сессий sessionsIndex/store.ts).
 */
export function openSqliteDb(file: string): WorkflowDb {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const bunSqlite = typeof getBuiltin === "function" ? (getBuiltin.call(process, "bun:sqlite") as { Database: new (file: string) => WorkflowDb } | undefined) : undefined;
  if (bunSqlite?.Database) {
    const db = new bunSqlite.Database(file);
    db.prepare("PRAGMA journal_mode = WAL").run();
    db.prepare("PRAGMA busy_timeout = 5000").run();
    return db;
  }
  const db = new BetterSqlite3(file) as unknown as WorkflowDb;
  db.prepare("PRAGMA journal_mode = WAL").run();
  db.prepare("PRAGMA busy_timeout = 5000").run();
  return db;
}

export type RunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";
export type StepStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "skipped" | "interrupted";

export interface WorkflowRunRecord {
  id: string;
  workspaceDir: string;
  workflowId: string;
  title: string;
  status: RunStatus;
  targetNodes: string[];
  input: Record<string, unknown>;
  snapshot: WorkflowDefinition;
  privacy: PrivacyMode;
  roadmapItemId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface WorkflowEvent {
  id: number;
  at: string;
  runId: string;
  type: string;
  stepId: string | null;
  attemptId: string | null;
  agentId: string | null;
  parentAgentId: string | null;
  payload: Record<string, unknown>;
}

function redactSecrets(value: string): string {
  return value
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]");
}

function analyticsPayload(mode: PrivacyMode, payload: Record<string, unknown>): Record<string, unknown> {
  if (mode === "aggregates") return Object.fromEntries(Object.entries(payload).filter(([, value]) => typeof value === "number" || typeof value === "boolean"));
  const sensitiveKeys = /prompt|response|content|questions|answer|comment/i;
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => {
    if (typeof value !== "string") return [key, value];
    const redacted = redactSecrets(value);
    if (mode === "metadata" && sensitiveKeys.test(key)) return [key, { size: Buffer.byteLength(redacted), hash: createHash("sha256").update(redacted).digest("hex") }];
    return [key, redacted];
  }));
}

function workspaceKey(workspaceDir: string): string {
  const name = path.basename(workspaceDir).replace(/[^a-zA-Z0-9._-]+/g, "-") || "workspace";
  return name + "-" + createHash("sha256").update(path.resolve(workspaceDir)).digest("hex").slice(0, 8);
}

export function workflowDbPath(repoRoot: string, workspaceDir: string): string {
  return path.join(repoRoot, ".agents", "console", "workspaces", workspaceKey(workspaceDir), "workflows.sqlite");
}

const SCHEMA_DDL = [
  "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace_dir TEXT NOT NULL, workflow_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, target_nodes_json TEXT NOT NULL, input_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, privacy TEXT NOT NULL, roadmap_item_id TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT)",
  "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id TEXT NOT NULL, type TEXT NOT NULL, step_id TEXT, attempt_id TEXT, agent_id TEXT, parent_agent_id TEXT, payload_json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_events_run_cursor ON events(run_id, id)",
  "CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL, status TEXT NOT NULL, runtime TEXT, provider TEXT, model TEXT, role_id TEXT, section TEXT, roles_json TEXT NOT NULL DEFAULT '[]', skills_json TEXT NOT NULL DEFAULT '[]', mcp_json TEXT NOT NULL DEFAULT '[]', started_at TEXT, finished_at TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0, cost_value REAL, cost_currency TEXT, error TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_attempts_run_step ON attempts(run_id, step_id)",
  "CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, consumed_at TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_commands_pending ON commands(consumed_at, id)",
  "CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT, checksum TEXT NOT NULL, content TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS node_cache (cache_key TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, step_id TEXT NOT NULL, source_run_id TEXT NOT NULL, outputs_json TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS worker_lease (key TEXT PRIMARY KEY, owner TEXT NOT NULL, heartbeat_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS usage_receipts (receipt_id TEXT PRIMARY KEY, at TEXT NOT NULL, run_id TEXT, step_id TEXT, provider TEXT NOT NULL, runtime TEXT, model TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_tokens INTEGER NOT NULL DEFAULT 0, cost_value REAL, cost_currency TEXT, pricing_coverage REAL NOT NULL DEFAULT 0, raw_json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
];

export class WorkflowStore {
  readonly db: WorkflowDb;
  readonly file: string;
  private privacyCache = new Map<string, PrivacyMode>();

  constructor(repoRoot: string, workspaceDir: string) {
    this.file = workflowDbPath(repoRoot, workspaceDir);
    mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = openSqliteDb(this.file);
    this.setup();
  }

  private setup() {
    for (const statement of SCHEMA_DDL) this.db.prepare(statement).run();
    // Схемная миграция существующих БД: тройка role_* сворачивается в role_id,
    // добавляются колонки секций; сбой не должен ломать открытие базы.
    try {
      const columns = new Set((this.db.prepare("PRAGMA table_info(attempts)").all() as Array<{ name: string }>).map((column) => column.name));
      if (!columns.has("role_id")) this.db.prepare("ALTER TABLE attempts ADD COLUMN role_id TEXT").run();
      if (!columns.has("section")) this.db.prepare("ALTER TABLE attempts ADD COLUMN section TEXT").run();
      if (!columns.has("roles_json")) this.db.prepare("ALTER TABLE attempts ADD COLUMN roles_json TEXT NOT NULL DEFAULT '[]'").run();
      if (columns.has("role_process") && !this.hasMigration("attempts-rebuild")) {
        // Легаси-таблица с NOT NULL-колонками старой схемы пересобирается в текущую форму.
        this.db.prepare("CREATE TABLE attempts_rebuild (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL, status TEXT NOT NULL, runtime TEXT, provider TEXT, model TEXT, role_id TEXT, section TEXT, roles_json TEXT NOT NULL DEFAULT '[]', skills_json TEXT NOT NULL DEFAULT '[]', mcp_json TEXT NOT NULL DEFAULT '[]', started_at TEXT, finished_at TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0, cost_value REAL, cost_currency TEXT, error TEXT)").run();
        this.db.prepare("INSERT INTO attempts_rebuild (id, run_id, step_id, status, runtime, provider, model, role_id, section, roles_json, skills_json, mcp_json, started_at, finished_at, input_tokens, output_tokens, cache_tokens, cost_value, cost_currency, error) SELECT id, run_id, step_id, status, runtime, provider, model, COALESCE(role_id, ''), COALESCE(section, ''), COALESCE(roles_json, '[]'), COALESCE(skills_json, '[]'), COALESCE(mcp_json, '[]'), started_at, finished_at, input_tokens, output_tokens, cache_tokens, cost_value, cost_currency, error FROM attempts").run();
        this.db.prepare("DROP TABLE attempts").run();
        this.db.prepare("ALTER TABLE attempts_rebuild RENAME TO attempts").run();
        this.db.prepare("CREATE INDEX IF NOT EXISTS idx_attempts_run_step ON attempts(run_id, step_id)").run();
        this.markMigration("attempts-rebuild");
      }
    } catch {
      // Конкурентная миграция из другого процесса - повторится при следующем открытии.
    }
  }

  close() {
    this.db.close();
  }

  createRun(input: {
    workspaceDir: string;
    workflow: WorkflowDefinition;
    title: string;
    targetNodes?: string[];
    values?: Record<string, unknown>;
    privacy?: PrivacyMode;
    roadmapItemId?: string | null;
  }): WorkflowRunRecord {
    const now = new Date().toISOString();
    const run: WorkflowRunRecord = {
      id: "run-" + Date.now() + "-" + randomUUID().slice(0, 8),
      workspaceDir: input.workspaceDir,
      workflowId: input.workflow.id,
      title: input.title,
      status: "queued",
      targetNodes: input.targetNodes ?? [],
      input: input.values ?? {},
      snapshot: input.workflow,
      privacy: input.privacy ?? input.workflow.defaults.privacy,
      roadmapItemId: input.roadmapItemId ?? null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
    };
    this.db.prepare("INSERT INTO runs (id, workspace_dir, workflow_id, title, status, target_nodes_json, input_json, snapshot_json, privacy, roadmap_item_id, created_at, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)").run(
      run.id, run.workspaceDir, run.workflowId, run.title, run.status,
      JSON.stringify(run.targetNodes), JSON.stringify(run.input), JSON.stringify(run.snapshot),
      run.privacy, run.roadmapItemId, run.createdAt,
    );
    this.appendEvent(run.id, "run.created", { workflowId: run.workflowId, targetNodes: run.targetNodes });
    this.enqueueCommand(run.id, "start", {});
    return run;
  }

  listRuns(limit = 100): WorkflowRunRecord[] {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(rowToRun);
  }

  getRun(id: string): WorkflowRunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  updateRun(id: string, status: RunStatus, fields: { error?: string | null; startedAt?: string | null; finishedAt?: string | null } = {}) {
    this.db.prepare("UPDATE runs SET status = ?, error = CASE WHEN ? = 1 THEN ? ELSE error END, started_at = CASE WHEN ? = 1 THEN ? ELSE started_at END, finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END WHERE id = ?")
      .run(status, fields.error === undefined ? 0 : 1, fields.error ?? null, fields.startedAt === undefined ? 0 : 1, fields.startedAt ?? null, fields.finishedAt === undefined ? 0 : 1, fields.finishedAt ?? null, id);
  }

  updateRunSnapshot(id: string, snapshot: WorkflowDefinition) {
    this.db.prepare("UPDATE runs SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(snapshot), id);
  }

  appendEvent(
    runId: string,
    type: string,
    payload: Record<string, unknown>,
    refs: { stepId?: string; attemptId?: string; agentId?: string; parentAgentId?: string } = {},
  ): number {
    const cached = this.privacyCache.get(runId);
    const privacy = cached ?? (this.db.prepare("SELECT privacy FROM runs WHERE id = ?").get(runId) as { privacy?: PrivacyMode } | undefined)?.privacy ?? "metadata";
    if (cached === undefined) this.privacyCache.set(runId, privacy);
    const safePayload = analyticsPayload(privacy, payload);
    const result = this.db.prepare("INSERT INTO events(at, run_id, type, step_id, attempt_id, agent_id, parent_agent_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      new Date().toISOString(), runId, type, refs.stepId ?? null, refs.attemptId ?? null,
      refs.agentId ?? null, refs.parentAgentId ?? null, JSON.stringify(safePayload),
    );
    return Number(result.lastInsertRowid);
  }

  /** Число событий типа у шага: счётчик попыток и циклов доработки. */
  countEvents(runId: string, stepId: string, type: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS count FROM events WHERE run_id = ? AND step_id = ? AND type = ?").get(runId, stepId, type) as { count: number }).count);
  }

  listEvents(runId: string, after = 0, limit = 500): WorkflowEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?")
      .all(runId, after, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id),
      at: String(row.at),
      runId: String(row.run_id),
      type: String(row.type),
      stepId: row.step_id ? String(row.step_id) : null,
      attemptId: row.attempt_id ? String(row.attempt_id) : null,
      agentId: row.agent_id ? String(row.agent_id) : null,
      parentAgentId: row.parent_agent_id ? String(row.parent_agent_id) : null,
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    }));
  }

  enqueueCommand(runId: string, type: string, payload: Record<string, unknown>) {
    this.db.prepare("INSERT INTO commands(at, run_id, type, payload_json) VALUES (?, ?, ?, ?)")
      .run(new Date().toISOString(), runId, type, JSON.stringify(payload));
  }

  takeCommands(limit = 20): Array<{ id: number; runId: string; type: string; payload: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT id, run_id, type, payload_json FROM commands WHERE consumed_at IS NULL ORDER BY id ASC LIMIT ?")
      .all(limit) as Array<{ id: number; run_id: string; type: string; payload_json: string }>;
    const mark = this.db.prepare("UPDATE commands SET consumed_at = ? WHERE id = ?");
    const now = new Date().toISOString();
    this.db.transaction(() => rows.forEach((row) => mark.run(now, row.id)))();
    return rows.map((row) => ({ id: row.id, runId: row.run_id, type: row.type, payload: JSON.parse(row.payload_json) }));
  }

  beginAttempt(runId: string, stepId: string, metadata: {
    runtime?: string;
    /** Фактический провайдер ("ollama") для кандидата "provider:<id>"; для CLI-рантаймов пусто. */
    provider?: string;
    model?: string;
    roles: string[];
    section: string;
    skills: string[];
    mcp: string[];
  }): string {
    const id = "attempt-" + randomUUID();
    this.db.prepare("INSERT INTO attempts(id, run_id, step_id, status, runtime, provider, model, role_id, section, roles_json, skills_json, mcp_json, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, runId, stepId, metadata.runtime ?? null, metadata.provider ?? null, metadata.model ?? null,
      metadata.roles[0] ?? null, metadata.section, JSON.stringify(metadata.roles),
      JSON.stringify(metadata.skills), JSON.stringify(metadata.mcp),
      new Date().toISOString(),
    );
    return id;
  }

  finishAttempt(id: string, status: StepStatus, error: string | null = null, usage?: { inputTokens: number; outputTokens: number; cacheTokens: number; costValue?: number; costCurrency?: string }) {
    this.db.prepare("UPDATE attempts SET status = ?, finished_at = ?, error = ?, input_tokens = ?, output_tokens = ?, cache_tokens = ?, cost_value = ?, cost_currency = ? WHERE id = ?")
      .run(status, new Date().toISOString(), error, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage?.cacheTokens ?? 0, usage?.costValue ?? null, usage?.costCurrency ?? null, id);
  }

  recordUsage(input: { receiptId: string; runId?: string; stepId?: string; provider: string; runtime?: string; model?: string; inputTokens: number; outputTokens: number; cacheTokens?: number; costValue?: number; costCurrency?: string; pricingCoverage?: number; raw: unknown }): boolean {
    const result = this.db.prepare("INSERT OR IGNORE INTO usage_receipts(receipt_id, at, run_id, step_id, provider, runtime, model, input_tokens, output_tokens, cache_tokens, cost_value, cost_currency, pricing_coverage, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(input.receiptId, new Date().toISOString(), input.runId ?? null, input.stepId ?? null, input.provider, input.runtime ?? null, input.model ?? null, input.inputTokens, input.outputTokens, input.cacheTokens ?? 0, input.costValue ?? null, input.costCurrency ?? null, input.pricingCoverage ?? 0, JSON.stringify(input.raw));
    return result.changes > 0;
  }

  listUsageReceipts(limit = 2000) {
    return this.db.prepare("SELECT * FROM usage_receipts ORDER BY at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  }

  hasMigration(id: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM migrations WHERE id = ?").get(id)); }
  markMigration(id: string) { this.db.prepare("INSERT OR IGNORE INTO migrations(id, applied_at) VALUES (?, ?)").run(id, new Date().toISOString()); }

  listAttempts(runId?: string) {
    return runId
      ? this.db.prepare("SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at").all(runId)
      : this.db.prepare("SELECT * FROM attempts ORDER BY started_at DESC LIMIT 1000").all();
  }

  latestArtifact(runId: string, stepId: string, name: string): { content: string; checksum: string } | null {
    const row = this.db.prepare(
      "SELECT content, checksum FROM artifacts WHERE run_id = ? AND step_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1",
    ).get(runId, stepId, name) as { content: string | null; checksum: string } | undefined;
    return row ? { content: row.content ?? "", checksum: row.checksum } : null;
  }

  listArtifacts(runId: string) {
    return this.db.prepare("SELECT id, step_id AS stepId, name, path, checksum, created_at AS createdAt FROM artifacts WHERE run_id = ? ORDER BY created_at").all(runId);
  }

  /** Артефакты шага с содержимым; выдачу контента наружу ограничивает privacy вызывающего роута. */
  listStepArtifacts(runId: string, stepId: string): Array<{ id: string; name: string; path: string | null; checksum: string; content: string | null; createdAt: string }> {
    return this.db.prepare("SELECT id, name, path, checksum, content, created_at AS createdAt FROM artifacts WHERE run_id = ? AND step_id = ? ORDER BY created_at").all(runId, stepId) as Array<{ id: string; name: string; path: string | null; checksum: string; content: string | null; createdAt: string }>;
  }

  listStepEvents(runId: string, stepId: string, limit = 1000): WorkflowEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE run_id = ? AND step_id = ? ORDER BY id ASC LIMIT ?").all(runId, stepId, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id),
      at: String(row.at),
      runId: String(row.run_id),
      type: String(row.type),
      stepId: row.step_id ? String(row.step_id) : null,
      attemptId: row.attempt_id ? String(row.attempt_id) : null,
      agentId: row.agent_id ? String(row.agent_id) : null,
      parentAgentId: row.parent_agent_id ? String(row.parent_agent_id) : null,
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    }));
  }

  listStepAttempts(runId: string, stepId: string) {
    return this.db.prepare("SELECT * FROM attempts WHERE run_id = ? AND step_id = ? ORDER BY started_at").all(runId, stepId);
  }

  /** Последнее конечное событие каждого шага: основа решения о повторе и очистке. */
  stepEndStates(runId: string): Array<{ stepId: string; type: string }> {
    const rows = this.db.prepare(
      "SELECT e.step_id AS stepId, e.type AS type FROM events e JOIN (SELECT step_id, MAX(id) AS last_id FROM events WHERE run_id = ? AND step_id IS NOT NULL AND type IN ('step.completed', 'step.failed', 'step.skipped') GROUP BY step_id) last ON last.step_id = e.step_id AND last.last_id = e.id",
    ).all(runId) as Array<{ stepId: string; type: string }>;
    return rows;
  }

  /**
   * Очистка артефактов перед повтором: маркеры исполнения и выходы шагов
   * удаляются, чтобы cachedCall не вернул прошлый результат. Находки ошибок
   * (`__err-`) и возвратов (`__ret-accept-`, `__ret-input-`) вместе с выводами
   * lessons learned (шаг `lessons`) сохраняются - они входят в выученные уроки.
   */
  clearRunArtifacts(runId: string, opts: { keepStepIds?: string[] } = {}) {
    const keep = ["lessons", ...(opts.keepStepIds ?? [])];
    const placeholders = keep.map(() => "?").join(", ");
    // Подчёркивание в LIKE - wildcard: префиксы маркеров сравниваются с ESCAPE.
    return this.db.prepare(
      "DELETE FROM artifacts WHERE run_id = ? AND step_id NOT IN (" + placeholders + ") AND name NOT LIKE '\\_\\_err-%' ESCAPE '\\' AND name NOT LIKE '\\_\\_ret-accept-%' ESCAPE '\\' AND name NOT LIKE '\\_\\_ret-input-%' ESCAPE '\\'",
    ).run(runId, ...keep);
  }

  /** Сброс потока LangGraph: чекпоинты и записи шага удаляются, следующий invoke идёт с START. */
  deleteRunThread(runId: string) {
    // Таблицы создаёт SqliteSaver при первом обращении; до этого DELETE упал бы - повторяем его DDL.
    this.db.prepare("CREATE TABLE IF NOT EXISTS checkpoints (thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL, parent_checkpoint_id TEXT, type TEXT, checkpoint BLOB, metadata BLOB, PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id))").run();
    this.db.prepare("CREATE TABLE IF NOT EXISTS writes (thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL, task_id TEXT NOT NULL, idx INTEGER NOT NULL, channel TEXT NOT NULL, type TEXT, value BLOB, PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx))").run();
    this.db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(runId);
    this.db.prepare("DELETE FROM writes WHERE thread_id = ?").run(runId);
  }

  /** Полное удаление прогона: журнал, попытки, артефакты, команды, чекпоинты, usage. Папка задачи удаляется вызывающим. */
  deleteRun(runId: string) {
    for (const table of ["events", "attempts", "commands", "artifacts", "usage_receipts"]) {
      this.db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(runId);
    }
    this.db.prepare("DELETE FROM node_cache WHERE source_run_id = ?").run(runId);
    this.deleteRunThread(runId);
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  }

  saveArtifact(runId: string, stepId: string, name: string, content: string, artifactPath?: string) {
    const checksum = createHash("sha256").update(content).digest("hex");
    this.db.prepare("INSERT INTO artifacts(id, run_id, step_id, name, path, checksum, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("artifact-" + randomUUID(), runId, stepId, name, artifactPath ?? null, checksum, content, new Date().toISOString());
    return checksum;
  }

  cachedNode(cacheKey: string): { sourceRunId: string; outputs: Record<string, string> } | null {
    const row = this.db.prepare("SELECT source_run_id, outputs_json FROM node_cache WHERE cache_key = ?").get(cacheKey) as { source_run_id: string; outputs_json: string } | undefined;
    return row ? { sourceRunId: row.source_run_id, outputs: JSON.parse(row.outputs_json) as Record<string, string> } : null;
  }

  saveNodeCache(cacheKey: string, workflowId: string, stepId: string, sourceRunId: string, outputs: Record<string, string>) {
    this.db.prepare("INSERT OR REPLACE INTO node_cache(cache_key, workflow_id, step_id, source_run_id, outputs_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(cacheKey, workflowId, stepId, sourceRunId, JSON.stringify(outputs), new Date().toISOString());
  }

  /** Число артефактов шага с префиксом имени: детерминированные счётчики циклов доработки. */
  countArtifacts(runId: string, stepId: string, namePrefix: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = ? AND step_id = ? AND name LIKE ?").get(runId, stepId, namePrefix + "%") as { count: number }).count);
  }

  acquireLease(owner: string, ttlMs = 10_000): boolean {
    const current = this.db.prepare("SELECT owner, heartbeat_at FROM worker_lease WHERE key = 'worker'").get() as
      | { owner: string; heartbeat_at: string }
      | undefined;
    const stale = !current || Date.now() - Date.parse(current.heartbeat_at) > ttlMs;
    if (current && current.owner !== owner && !stale) return false;
    this.db.prepare(
      "INSERT INTO worker_lease(key, owner, heartbeat_at) VALUES ('worker', ?, ?) ON CONFLICT(key) DO UPDATE SET owner = excluded.owner, heartbeat_at = excluded.heartbeat_at",
    ).run(owner, new Date().toISOString());
    return true;
  }

  heartbeatLease(owner: string) {
    this.db.prepare("UPDATE worker_lease SET heartbeat_at = ? WHERE key = 'worker' AND owner = ?")
      .run(new Date().toISOString(), owner);
  }

  hasPendingCommand(runId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM commands WHERE run_id = ? AND consumed_at IS NULL LIMIT 1").get(runId));
  }

  /**
   * Попытки с указанной моделью или рантаймом для детализации статистики:
   * последние N, с заголовком и статусом прогона (для ссылок на страницу run).
   */
  attemptsBy(column: "model" | "runtime", value: string, sinceIso: string | null, limit = 20) {
    const since = sinceIso ? `WHERE a.${column} = ? AND a.started_at >= ?` : `WHERE a.${column} = ?`;
    const args = sinceIso ? [value, sinceIso, limit] : [value, limit];
    return this.db
      .prepare(
        `SELECT a.run_id AS runId, r.title AS runTitle, r.workflow_id AS workflowId, r.status AS runStatus, a.step_id AS stepId, a.section, a.status, a.started_at AS startedAt, a.finished_at AS finishedAt, a.input_tokens AS inputTokens, a.output_tokens AS outputTokens, a.cache_tokens AS cacheTokens, a.cost_value AS costValue ` +
          `FROM attempts a JOIN runs r ON r.id = a.run_id ${since} ORDER BY a.started_at DESC LIMIT ?`,
      )
      .all(...args);
  }

  /**
   * Агрегаты статистики; options.since (ISO) ограничивает выборку снизу по
   * времени (attempts/usage_receipts - started_at/at, runs - created_at),
   * options.runtime оставляет записи одного рантайма. Без options - вся история.
   */
  stats(options?: { since?: string | null; runtime?: string | null }) {
    const since = options?.since ?? null;
    const runtime = options?.runtime ?? null;
    const attemptClauses: string[] = [];
    const attemptArgs: string[] = [];
    if (since) {
      attemptClauses.push("a.started_at >= ?");
      attemptArgs.push(since);
    }
    if (runtime) {
      attemptClauses.push("a.runtime = ?");
      attemptArgs.push(runtime);
    }
    const attemptWhere = attemptClauses.length > 0 ? `WHERE ${attemptClauses.join(" AND ")}` : "";
    const usageClauses: string[] = [];
    const usageArgs: string[] = [];
    if (since) {
      usageClauses.push("at >= ?");
      usageArgs.push(since);
    }
    if (runtime) {
      usageClauses.push("runtime = ?");
      usageArgs.push(runtime);
    }
    const usageWhere = usageClauses.length > 0 ? `WHERE ${usageClauses.join(" AND ")}` : "";
    const runs = this.db.prepare(`SELECT status, COUNT(*) AS count FROM runs ${since ? "WHERE created_at >= ?" : ""} GROUP BY status`).all(...(since ? [since] : []));
    const runsByWorkflow = this.db.prepare(`SELECT workflow_id AS workflow, COUNT(*) AS runs, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN status IN ('failed', 'interrupted') THEN 1 ELSE 0 END) AS stopped FROM runs ${since ? "WHERE created_at >= ?" : ""} GROUP BY workflow_id ORDER BY runs DESC`).all(...(since ? [since] : []));
    const attempts = this.db.prepare(`SELECT a.status, COUNT(*) AS count, SUM(a.input_tokens) AS inputTokens, SUM(a.output_tokens) AS outputTokens, SUM(a.cache_tokens) AS cacheTokens, SUM(a.cost_value) AS knownCost, SUM((julianday(a.finished_at)-julianday(a.started_at))*86400000) AS wallMs FROM attempts a ${attemptWhere} GROUP BY a.status`).all(...attemptArgs);
    const byRole = this.db.prepare(`SELECT a.role_id AS role, COUNT(*) AS attempts, SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed FROM attempts a ${attemptWhere} GROUP BY a.role_id ORDER BY attempts DESC`).all(...attemptArgs);
    const byStep = this.db.prepare(`SELECT r.workflow_id AS workflow, a.step_id AS step, COALESCE(a.section, '') AS section, COUNT(*) AS calls, SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed, SUM(a.input_tokens) AS inputTokens, SUM(a.output_tokens) AS outputTokens, SUM(a.cost_value) AS cost FROM attempts a JOIN runs r ON r.id = a.run_id ${attemptWhere} GROUP BY r.workflow_id, a.step_id, a.section ORDER BY calls DESC LIMIT 30`).all(...attemptArgs);
    const usage = this.db.prepare(`SELECT provider, model, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, SUM(cache_tokens) AS cacheTokens, SUM(cost_value) AS knownCost, AVG(pricing_coverage) AS pricingCoverage FROM usage_receipts ${usageWhere} GROUP BY provider, model`).all(...usageArgs);
    const totals = this.db.prepare(`SELECT COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(cache_tokens), 0) AS cacheTokens, COALESCE(SUM(cost_value), 0) AS knownCost FROM usage_receipts ${usageWhere}`).get(...usageArgs) as { inputTokens: number; outputTokens: number; cacheTokens: number; knownCost: number };
    return { runs, runsByWorkflow, attempts, byRole, byStep, usage, totals };
  }
}

/** Дневная строка usage для heatmap: день, модель, разбивка токенов и зафиксированная стоимость. */
export interface UsageDailyRow {
  day: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  knownCost: number;
}

/**
 * Дневная агрегация usage_receipts по всем workspace-хранилищам
 * (каталог .agents/console/workspaces, файл workflows.sqlite в каждом)
 * для heatmap и ряда расхода. dimension="model" (по умолчанию) группирует по
 * модели, "runtime" - по рантайму (без рантайма - провайдер; значение
 * возвращается в поле model). Битые и неполные БД пропускаются.
 * Оценка стоимости по каталогу выполняет вызывающий код (нужен readCatalog).
 */
export function usageDailyAcrossWorkspaces(repoRoot: string, sinceIso: string, dimension: "model" | "runtime" = "model"): UsageDailyRow[] {
  const base = path.join(repoRoot, ".agents", "console", "workspaces");
  let files: string[] = [];
  try {
    files = readdirSync(base)
      .map((entry) => path.join(base, entry, "workflows.sqlite"))
      .filter((file) => existsSync(file));
  } catch {
    return [];
  }
  const groupBy = dimension === "runtime" ? "COALESCE(runtime, provider)" : "model";
  const byDayModel = new Map<string, UsageDailyRow>();
  for (const file of files) {
    let db: WorkflowDb;
    try {
      db = openSqliteDb(file);
    } catch {
      continue;
    }
    try {
      const rows = db.prepare(`SELECT substr(at, 1, 10) AS day, ${groupBy} AS model, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, SUM(cache_tokens) AS cacheTokens, SUM(cost_value) AS knownCost FROM usage_receipts WHERE at >= ? GROUP BY day, ${groupBy}`).all(sinceIso) as
        { day: string; model: string | null; inputTokens: number | null; outputTokens: number | null; cacheTokens: number | null; knownCost: number | null }[];
      for (const row of rows) {
        const key = `${row.day}\u0000${row.model ?? ""}`;
        const entry = byDayModel.get(key) ?? { day: row.day, model: row.model, inputTokens: 0, outputTokens: 0, cacheTokens: 0, knownCost: 0 };
        entry.inputTokens += row.inputTokens ?? 0;
        entry.outputTokens += row.outputTokens ?? 0;
        entry.cacheTokens += row.cacheTokens ?? 0;
        entry.knownCost += row.knownCost ?? 0;
        byDayModel.set(key, entry);
      }
    } catch {
      /* таблицы usage_receipts нет - хранилище пропускается */
    } finally {
      db.close();
    }
  }
  return [...byDayModel.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function rowToRun(row: Record<string, unknown>): WorkflowRunRecord {
  return {
    id: String(row.id),
    workspaceDir: String(row.workspace_dir),
    workflowId: String(row.workflow_id),
    title: String(row.title),
    status: row.status as RunStatus,
    targetNodes: JSON.parse(String(row.target_nodes_json)),
    input: JSON.parse(String(row.input_json)),
    snapshot: JSON.parse(String(row.snapshot_json)),
    privacy: row.privacy as PrivacyMode,
    roadmapItemId: row.roadmap_item_id ? String(row.roadmap_item_id) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    error: row.error ? String(row.error) : null,
  };
}
