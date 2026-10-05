import { open as openFile, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { loadConsoleState } from "@/core/state";
import { effectiveModelPrice, type CatalogData, type EffectivePrice } from "@/core/pricingCatalog";
import { readCatalog } from "@/core/pricingCatalogServer";
import { parseCodexRolloutStart } from "@/core/sessions/codex";
import { listTranscriptFiles, readNewLines } from "@/core/usage/runtimeTranscripts";
import { dayKey } from "@/lib/format";
import { SessionIndexStore, type CollectOutcome, type SessionDelta } from "./store";

/**
 * Коллектор индекса сессий: инкрементально разбирает транскрипты рантаймов
 * и аккумулирует историю в sessions.sqlite (по модели agentsview).
 *
 *  - Claude Code: per-message usage, tool_use, тексты JSONL в ~/.claude/projects/<slug>/;
 *  - Codex: rollout-*.jsonl - сообщения, function_call, кумулятив token_count дельтой;
 *  - ZCode: model-io-*.jsonl - per-request usage (дедуп по requestId), модель, title;
 *  - Kimi: session_index.jsonl + state.json - метаданные (токенов в файлах нет);
 *  - OpenCode: opencode.db через sqlite3 -readonly - сессии и тексты сообщений.
 *
 * Первый запуск на файле больше skipLargeBytes пропускает историю - индекс
 * ведётся с момента установки. Повторные проходы читают только новые строки
 * (курсоры в sync_cursors самой БД).
 */

const SKIP_LARGE_CLAUDE = 32_000_000;
const SKIP_LARGE_ZCODE = 8_000_000;
const MESSAGE_TEXT_LIMIT = 2_000;
/** TTL ленивого сбора из API-роутов. */
export const SESSIONS_INDEX_TTL_MS = 5 * 60_000;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export interface SessionsIndexOptions {
  home?: string;
  claudeDir?: string;
  codexDirs?: string[];
  zcodeDir?: string;
  kimiIndex?: string;
  /** Сбор OpenCode (sqlite3 -readonly); true по умолчанию, отключается в тестах. */
  opencode?: boolean;
  /** Переопределение настройки contentSearch (тесты); по умолчанию - settings.sessionIndex. */
  contentSearch?: boolean;
}

interface DayAgg {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
}

type PriceFn = (model: string | undefined, input: number, output: number, cache: number) => { costUsd: number; priced: number };

/** Накопитель одного прохода: дельты сессий, дневные агрегаты, курсоры. */
class PassAccumulator {
  sessions = new Map<string, SessionDelta>();
  days: Record<string, DayAgg> = {};
  tools: Record<string, number> = {};
  cursors: Record<string, number> = {};
  cursorMeta: Record<string, string> = {};

  get(runtime: string, sessionId: string): SessionDelta {
    const key = `${runtime}:${sessionId}`;
    let delta = this.sessions.get(key);
    if (!delta) {
      delta = {
        runtime,
        sessionId,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        costUsd: 0,
        pricedTokens: 0,
        turns: 0,
        messages: [],
        tools: {},
        lastActivityAt: "",
      };
      this.sessions.set(key, delta);
    }
    return delta;
  }

  setCursor(key: string, cursor: number, meta?: Record<string, unknown>): void {
    this.cursors[key] = cursor;
    if (meta) this.cursorMeta[key] = JSON.stringify(meta);
  }

  addMessage(delta: SessionDelta, role: "user" | "assistant" | "system", at: string | undefined, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    delta.messages.push({ role, at, text: trimmed.slice(0, MESSAGE_TEXT_LIMIT) });
    if (role === "user") delta.turns += 1;
  }

  /** Вызов инструмента: счётчик сессии + дневной агрегат по дню события. */
  addTool(delta: SessionDelta, name: string, at?: string): void {
    if (!name) return;
    delta.tools[name] = (delta.tools[name] ?? 0) + 1;
    const key = `${delta.runtime}|${dayKey(at ?? new Date().toISOString())}|${name}`;
    this.tools[key] = (this.tools[key] ?? 0) + 1;
  }

  /** Токены дельты: сессия + дневной агрегат; стоимость - по каталогу цен. */
  addUsage(delta: SessionDelta, price: PriceFn, at: string | undefined, model: string | undefined, input: number, output: number, cache: number): void {
    if (!input && !output && !cache) return;
    const { costUsd, priced } = price(model, input, output, cache);
    delta.inputTokens += input;
    delta.outputTokens += output;
    delta.cacheTokens += cache;
    delta.costUsd += costUsd;
    delta.pricedTokens += priced;
    if (model && !delta.models?.includes(model)) (delta.models ??= []).push(model);
    const agg = (this.days[`${delta.runtime}|${dayKey(at ?? new Date().toISOString())}`] ??= { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 });
    agg.inputTokens += input;
    agg.outputTokens += output;
    agg.cacheTokens += cache;
    agg.costUsd += costUsd;
  }

  /** Свежесть дельты: максимум из времени события и mtime файла. */
  touch(delta: SessionDelta, at: string | undefined, fallback: string): void {
    if (at && at > delta.lastActivityAt) {
      delta.lastActivityAt = at;
      return;
    }
    if (!delta.lastActivityAt && fallback) delta.lastActivityAt = fallback;
  }
}

/** Расчёт стоимости по каталогу цен; модели нет в каталоге - cost 0, токены не покрыты. */
function makePriceFn(catalog: CatalogData | null): PriceFn {
  const cache = new Map<string, EffectivePrice>();
  return (model, input, output, cacheTokens) => {
    if (!model || !catalog) return { costUsd: 0, priced: 0 };
    let price = cache.get(model);
    if (!price) {
      price = effectiveModelPrice(catalog, model);
      cache.set(model, price);
    }
    if (price.origin === "none") return { costUsd: 0, priced: 0 };
    return {
      costUsd: (input * price.inputPerMtok + output * price.outputPerMtok + cacheTokens * (price.cacheReadPerMtok ?? 0)) / 1e6,
      priced: input + output + cacheTokens,
    };
  };
}

/* --------------------------------- Claude Code --------------------------------- */

/** Текст из content записи Claude: строка или массив блоков (только type text). */
function claudeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

async function collectClaude(root: string, store: SessionIndexStore, acc: PassAccumulator, price: PriceFn): Promise<void> {
  const files = await listTranscriptFiles(root, (name) => name.endsWith(".jsonl"), 2, 400);
  for (const file of files) {
    const key = `claude:${file.path}`;
    const { lines, cursor } = await readNewLines(file.path, file.size, store.getCursor(key).cursor || undefined, SKIP_LARGE_CLAUDE);
    acc.setCursor(key, cursor);
    const fallbackId = path.basename(file.path).replace(/\.jsonl$/, "");
    const mtimeIso = new Date(file.mtimeMs).toISOString();
    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = entry.type;
      if (type !== "user" && type !== "assistant") continue;
      const sessionId = str(entry.sessionId) ?? fallbackId;
      const delta = acc.get("claude", sessionId);
      delta.filePath ??= file.path;
      delta.sizeBytes = Math.max(delta.sizeBytes ?? 0, file.size);
      delta.workspaceDir ||= str(entry.cwd);
      const at = str(entry.timestamp);
      if (!delta.startedAt && at) delta.startedAt = at;
      acc.touch(delta, at, mtimeIso);

      const message = entry.message as Record<string, unknown> | undefined;
      if (!message || typeof message !== "object") continue;
      if (type === "assistant") {
        if (entry.isApiErrorMessage === true) continue;
        const text = claudeText(message.content);
        if (text) acc.addMessage(delta, "assistant", at, text);
        if (Array.isArray(message.content)) {
          for (const block of message.content as Array<{ type?: unknown; name?: unknown }>) {
            if (block && typeof block === "object" && block.type === "tool_use" && typeof block.name === "string") {
              acc.addTool(delta, block.name, at);
            }
          }
        }
        const model = str(message.model);
        const usage = message.usage as Record<string, unknown> | undefined;
        if (model && model !== "<synthetic>" && usage && typeof usage === "object") {
          acc.addUsage(delta, price, at, model, num(usage.input_tokens), num(usage.output_tokens), num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens));
        }
      } else {
        const text = claudeText(message.content);
        if (text) acc.addMessage(delta, "user", at, text);
      }
    }
  }
}

/* ------------------------------------ Codex ------------------------------------ */

async function readHeadLine(file: string, bytes = 8_192): Promise<Record<string, unknown> | null> {
  const fh = await openFile(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buffer, 0, bytes, 0);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0] ?? "";
    try {
      return JSON.parse(firstLine) as Record<string, unknown>;
    } catch {
      return null;
    }
  } finally {
    await fh.close();
  }
}

async function collectCodex(roots: string[], store: SessionIndexStore, acc: PassAccumulator, price: PriceFn): Promise<void> {
  const files = [];
  for (const root of roots) {
    files.push(...(await listTranscriptFiles(root, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"), 5, 300)));
  }
  for (const file of files) {
    const key = `codex:${file.path}`;
    const saved = store.getCursor(key);
    const meta = saved.meta as { cumIn?: number; cumOut?: number; mtimeMs?: number };
    if (meta.mtimeMs === file.mtimeMs) continue;
    const head = await readHeadLine(file.path);
    const headPayload = (head?.payload ?? {}) as Record<string, unknown>;
    const sessionId = str(headPayload.session_id) ?? str(head?.id) ?? path.basename(file.path).replace(/\.jsonl$/, "");
    const delta = acc.get("codex", sessionId);
    delta.filePath = file.path;
    delta.sizeBytes = Math.max(delta.sizeBytes ?? 0, file.size);
    delta.workspaceDir ||= str(headPayload.cwd);
    if (!delta.startedAt) delta.startedAt = parseCodexRolloutStart(path.basename(file.path));
    if (!delta.lastActivityAt) delta.lastActivityAt = new Date(file.mtimeMs).toISOString();
    const mtimeIso = new Date(file.mtimeMs).toISOString();

    const { lines, cursor } = await readNewLines(file.path, file.size, saved.cursor || undefined, SKIP_LARGE_CLAUDE);
    let cumIn = num(meta.cumIn);
    let cumOut = num(meta.cumOut);
    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const payload = entry.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== "object") continue;
      const at = str(entry.timestamp);
      acc.touch(delta, at, mtimeIso);
      const ptype = str(payload.type);
      if (ptype === "user_message" || ptype === "agent_message" || ptype === "message") {
        const text = str(payload.message) ?? "";
        if (text) acc.addMessage(delta, ptype === "user_message" ? "user" : "assistant", at, text);
      } else if (ptype === "function_call") {
        acc.addTool(delta, str(payload.name) ?? "", at);
      } else if (ptype === "token_count") {
        const totals = (payload.info as { total_token_usage?: Record<string, unknown> } | undefined)?.total_token_usage;
        if (totals && typeof totals === "object") {
          const curIn = num(totals.input_tokens);
          const curOut = num(totals.output_tokens);
          const input = Math.max(0, curIn - cumIn);
          const output = Math.max(0, curOut - cumOut);
          cumIn = curIn;
          cumOut = curOut;
          acc.addUsage(delta, price, at, delta.models?.[0], input, output, num(totals.cached_input_tokens));
        }
      } else if (str(payload.model) && !delta.models?.includes(str(payload.model)!)) {
        // turn_context и подобные записи: модель текущего хода
        delta.models = [...(delta.models ?? []), str(payload.model)!];
      }
    }
    acc.setCursor(key, cursor, { cumIn, cumOut, mtimeMs: file.mtimeMs });
  }
}

/* ------------------------------------ ZCode ------------------------------------ */

/** Последний запрос пользователя в model-io записи - заголовок сессии (best-effort). */
function zcodeTitle(entry: Record<string, unknown>): string | undefined {
  const messages = (entry.request as { messages?: unknown } | undefined)?.messages;
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index] as { role?: unknown; content?: unknown } | undefined;
    if (!item || item.role !== "user") continue;
    return zcodeContentText(item.content)?.slice(0, 160);
  }
  return undefined;
}

function zcodeContentText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      const item = part as { type?: unknown; text?: unknown };
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
  return text.trim() || undefined;
}

async function collectZcode(root: string, plans: { dir: string; workspace: string } | null, store: SessionIndexStore, acc: PassAccumulator, price: PriceFn): Promise<void> {
  const files = await listTranscriptFiles(root, (name) => name.startsWith("model-io-sess_") && name.endsWith(".jsonl") && !name.includes("subagent"), 1, 400);
  const planSessions = plans
    ? new Set(
        (await listTranscriptFiles(plans.dir, (name) => name.startsWith("plan-sess_") && name.endsWith(".md"), 1, 200)).map(
          (file) => path.basename(file.path).match(/sess_[A-Za-z0-9-]+/)?.[0] ?? "",
        ),
      )
    : new Set<string>();
  for (const file of files) {
    const key = `zcode:${file.path}`;
    const { lines, cursor } = await readNewLines(file.path, file.size, store.getCursor(key).cursor || undefined, SKIP_LARGE_ZCODE);
    acc.setCursor(key, cursor);
    const fileName = path.basename(file.path);
    const sessionId = fileName.match(/sess_[A-Za-z0-9-]+/)?.[0] ?? fileName;
    const delta = acc.get("zcode", sessionId);
    delta.filePath = file.path;
    delta.sizeBytes = Math.max(delta.sizeBytes ?? 0, file.size);
    if (plans && planSessions.has(sessionId)) delta.workspaceDir ||= plans.workspace;
    const mtimeIso = new Date(file.mtimeMs).toISOString();
    if (!delta.lastActivityAt) delta.lastActivityAt = mtimeIso;
    const seen = new Set<string>();
    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const at = str(entry.completedAt) ?? str(entry.startedAt);
      acc.touch(delta, at, mtimeIso);
      delta.title ||= zcodeTitle(entry);
      if (!delta.startedAt) delta.startedAt = str(entry.startedAt);
      const usage = (entry.response as { usage?: Record<string, unknown> } | undefined)?.usage;
      if (!usage || typeof usage !== "object") continue;
      const requestId = str(entry.requestId);
      if (requestId) {
        if (seen.has(requestId)) continue;
        seen.add(requestId);
      }
      const model = (entry.model as { modelId?: unknown } | undefined)?.modelId;
      acc.addUsage(delta, price, at, typeof model === "string" ? model : undefined, num(usage.inputTokens), num(usage.outputTokens), num(usage.cacheReadTokens) + num(usage.cacheWriteTokens));
    }
  }
}

/* ------------------------------------ Kimi ------------------------------------ */

interface KimiIndexEntry {
  sessionId: string;
  sessionDir: string;
  workDir: string;
}

async function collectKimi(indexFile: string, store: SessionIndexStore, acc: PassAccumulator): Promise<void> {
  const info = await stat(indexFile).catch(() => null);
  if (!info) return;
  const { lines, cursor } = await readNewLines(indexFile, info.size, store.getCursor("kimi:index").cursor || undefined, 2_000_000);
  acc.setCursor("kimi:index", cursor);
  for (const line of lines) {
    let entry: Partial<KimiIndexEntry>;
    try {
      entry = JSON.parse(line) as Partial<KimiIndexEntry>;
    } catch {
      continue;
    }
    if (!entry.sessionId || !entry.sessionDir || !entry.workDir) continue;
    const delta = acc.get("kimi", entry.sessionId);
    delta.workspaceDir = entry.workDir;
    delta.filePath = entry.sessionDir;
    // метаданные сессии: state.json в каталоге (или подкаталоге) сессии
    const candidates = [path.join(entry.sessionDir, "state.json"), path.join(entry.sessionDir, entry.sessionId, "state.json")];
    for (const candidate of candidates) {
      const meta = await stat(candidate).catch(() => null);
      if (!meta) continue;
      try {
        const parsed = JSON.parse(await readFile(candidate, "utf8")) as { title?: unknown; createdAt?: unknown; updatedAt?: unknown };
        delta.title ||= typeof parsed.title === "string" && parsed.title !== "New Session" ? parsed.title : undefined;
        delta.startedAt ||= typeof parsed.createdAt === "string" ? parsed.createdAt : undefined;
        acc.touch(delta, typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined, meta.mtime.toISOString());
      } catch {
        acc.touch(delta, undefined, meta.mtime.toISOString());
      }
      break;
    }
  }
}

/* ---------------------------------- OpenCode ---------------------------------- */

function opencodeDbPath(home: string): string {
  return path.join(home, ".local", "share", "opencode", "opencode.db");
}

function queryRows(db: string, sql: string): Record<string, unknown>[] | null {
  const probe = spawnSync("sqlite3", ["-readonly", "-json", db, sql], { encoding: "utf8", timeout: 10_000 });
  if (probe.error || (probe.status !== 0 && probe.status !== null)) return null;
  try {
    const parsed = JSON.parse(probe.stdout || "[]");
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

/** Текстовая часть записи message (схема зависит от версии OpenCode). */
function opencodeText(raw: unknown): { role: "user" | "assistant" | "system"; text: string } | null {
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
  return { role, text };
}

function opencodeIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== "") return opencodeIso(asNumber);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

async function collectOpencode(home: string, store: SessionIndexStore, acc: PassAccumulator): Promise<void> {
  const db = opencodeDbPath(home);
  const rows = queryRows(db, "SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT 500");
  if (!rows) return;
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) continue;
    const delta = acc.get("opencode", row.id);
    if (typeof row.directory === "string" && row.directory.trim()) delta.workspaceDir ||= row.directory.replace(/\/+$/, "");
    delta.title ||= typeof row.title === "string" && row.title.trim() ? row.title.slice(0, 120) : undefined;
    delta.startedAt ||= opencodeIso(row.time_created);
    acc.touch(delta, opencodeIso(row.time_updated), opencodeIso(row.time_created) ?? "");
  }
  // новые сообщения: курсор по rowid таблицы message
  const lastRowid = num((store.getCursor("opencode:messages").meta as { lastRowid?: unknown }).lastRowid);
  const messages = queryRows(db, `SELECT rowid, session_id, data, time_created FROM message WHERE rowid > ${Math.floor(lastRowid)} ORDER BY rowid LIMIT 5000`);
  if (messages && messages.length > 0) {
    let maxRowid = lastRowid;
    for (const row of messages) {
      const rowid = num(row.rowid);
      if (rowid > maxRowid) maxRowid = rowid;
      if (typeof row.session_id !== "string" || !row.session_id) continue;
      const parsed = opencodeText(row.data);
      if (!parsed) continue;
      acc.addMessage(acc.get("opencode", row.session_id), parsed.role, opencodeIso(row.time_created), parsed.text);
    }
    acc.setCursor("opencode:messages", 0, { lastRowid: maxRowid });
  }
}

/* ------------------------------- сбор и запуск ------------------------------- */

export async function collectSessionsIndex(repoRoot: string, opts: SessionsIndexOptions = {}): Promise<number> {
  const home = opts.home ?? homedir();
  const contentSearch = opts.contentSearch ?? (await loadConsoleState(repoRoot)).settings.sessionIndex.contentSearch;
  const store = new SessionIndexStore(repoRoot);
  try {
    const catalog = await readCatalog(repoRoot).catch(() => null);
    const price = makePriceFn(catalog);
    const acc = new PassAccumulator();

    await collectClaude(opts.claudeDir ?? path.join(home, ".claude", "projects"), store, acc, price);
    await collectZcode(
      opts.zcodeDir ?? path.join(home, ".zcode", "cli", "rollout"),
      opts.zcodeDir ? null : { dir: path.join(repoRoot, ".zcode", "plans"), workspace: repoRoot },
      store,
      acc,
      price,
    );
    await collectCodex(
      opts.codexDirs ?? [path.join(home, ".codex", "sessions"), path.join(home, ".codex", "archived_sessions")],
      store,
      acc,
      price,
    );
    await collectKimi(opts.kimiIndex ?? path.join(home, ".kimi-code", "session_index.jsonl"), store, acc);
    if (opts.opencode !== false) await collectOpencode(home, store, acc);

    const outcome: CollectOutcome = {
      sessions: [...acc.sessions.values()],
      days: acc.days,
      tools: acc.tools,
      cursors: acc.cursors,
      cursorMeta: acc.cursorMeta,
    };
    store.applyCollect(outcome, { contentSearch });
    return outcome.sessions.length;
  } finally {
    store.close();
  }
}

let ensureInFlight: Promise<number> | null = null;

/**
 * Ленивый сбор из API-роутов: не чаще TTL (5 мин); force - кнопка "Обновить".
 * Параллельные вызовы разделяют один проход.
 */
export function ensureSessionsIndex(repoRoot: string, opts: { force?: boolean } = {}): Promise<number> {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = (async () => {
    const store = new SessionIndexStore(repoRoot);
    const last = store.getMeta("last_sync_at");
    store.close();
    if (!opts.force && last && Date.now() - new Date(last).getTime() < SESSIONS_INDEX_TTL_MS) return 0;
    return collectSessionsIndex(repoRoot);
  })().finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}
