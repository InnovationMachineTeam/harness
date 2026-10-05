import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  applyUsageCollection,
  modelToProvider,
  readProviderUsage,
  vendorModelIndex,
  type UsageRecord,
} from "../providerUsage";

/**
 * Коллектор usage из транскриптов рантаймов (источник "runtime-session").
 * Инкрементальный: позиция обработки каждого файла хранится в
 * provider-usage.json (cursors) - повторный сбор читает только новые записи.
 *  - Claude Code: per-message usage в ~/.claude/projects/<slug>/*.jsonl;
 *  - Codex: кумулятивные token_count события в rollout-файлах - берётся
 *    последнее, пишется дельта от прошлого сбора;
 *  - ZCode: per-request usage в ~/.zcode/cli/rollout/model-io-*.jsonl.
 * Атрибуция провайдера - по имени модели (пресеты провайдеров, затем конфиги
 * рантаймов); без совпадения - "runtime:<id>".
 */

interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Файлы транскриптов: path, размер, mtime; сортировка по свежести. Общий обход для usage- и session-коллекторов. */
export async function listTranscriptFiles(root: string, match: (name: string) => boolean, maxDepth: number, limit: number): Promise<FileInfo[]> {
  const out: FileInfo[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= limit) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !match(entry.name)) continue;
      const info = await stat(full).catch(() => null);
      if (info) out.push({ path: full, size: info.size, mtimeMs: info.mtimeMs });
    }
  };
  await walk(root, 0);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Прочитать файл с позиции cursor до конца; парсируются только целые строки
 * (обрезанная последняя строка останется на следующий сбор). Первый запуск на
 * файле больше skipLargeBytes пропускает историю - статистика ведётся с
 * момента установки коллектора. Файл, ставший короче курсора, читается заново.
 */
export async function readNewLines(
  file: string,
  size: number,
  cursor: number | undefined,
  skipLargeBytes: number,
): Promise<{ lines: string[]; cursor: number }> {
  let start = cursor ?? 0;
  if (size < start) start = 0;
  if (cursor === undefined && size > skipLargeBytes) start = size;
  if (start >= size) return { lines: [], cursor: size };
  const fh = await open(file, "r");
  try {
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await fh.read(buffer, 0, length, start);
    const text = buffer.toString("utf8");
    // парсируются только целые строки; смещение курсора - в байтах, не символах
    const lastNewline = text.lastIndexOf("\n");
    const consumed = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : "";
    const lines = consumed.split("\n").filter((line) => line.trim());
    return { lines, cursor: start + Buffer.byteLength(consumed, "utf8") };
  } finally {
    await fh.close();
  }
}

/** Последние chunkBytes файла - поиск кумулятивного счётчика codex. */
async function readTail(file: string, size: number, chunkBytes: number): Promise<string[]> {
  const length = Math.min(size, chunkBytes);
  const fh = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    await fh.read(buffer, 0, length, size - length);
    return buffer.toString("utf8").split("\n").filter((line) => line.trim());
  } finally {
    await fh.close();
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cleanDetails(details: Record<string, number>): Record<string, number> | undefined {
  const meaningful = Object.fromEntries(Object.entries(details).filter(([, value]) => value > 0));
  return Object.keys(meaningful).length ? meaningful : undefined;
}

/* --------------------------------- Claude Code --------------------------------- */

async function collectClaude(
  root: string,
  cursors: Record<string, number>,
  vendors: Map<string, string>,
  records: UsageRecord[],
): Promise<void> {
  const files = await listTranscriptFiles(root, (name) => name.endsWith(".jsonl"), 2, 400);
  for (const file of files) {
    const key = `claude:${file.path}`;
    const { lines, cursor } = await readNewLines(file.path, file.size, cursors[key], 8_000_000);
    cursors[key] = cursor;
    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (entry.type !== "assistant" || entry.isApiErrorMessage === true) continue;
      const message = entry.message as Record<string, unknown> | undefined;
      if (!message || typeof message !== "object") continue;
      const model = typeof message.model === "string" ? message.model : "";
      if (!model || model === "<synthetic>") continue;
      const usage = message.usage as Record<string, unknown> | undefined;
      if (!usage || typeof usage !== "object") continue;
      const input = num(usage.input_tokens);
      const output = num(usage.output_tokens);
      const cacheRead = num(usage.cache_read_input_tokens);
      const cacheCreation = num(usage.cache_creation_input_tokens);
      if (!input && !output && !cacheRead && !cacheCreation) continue;
      records.push({
        at: typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
        source: "runtime-session",
        provider: modelToProvider(model, vendors) ?? "runtime:claude",
        model,
        runtime: "claude",
        kind: typeof entry.sessionId === "string" ? entry.sessionId : path.basename(file.path),
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        details: cleanDetails({ cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheCreation }),
      });
    }
  }
}

/* ------------------------------------ ZCode ------------------------------------ */

async function collectZcode(
  root: string,
  cursors: Record<string, number>,
  vendors: Map<string, string>,
  records: UsageRecord[],
): Promise<void> {
  const files = await listTranscriptFiles(root, (name) => name.startsWith("model-io-") && name.endsWith(".jsonl"), 1, 400);
  for (const file of files) {
    const key = `zcode:${file.path}`;
    const { lines, cursor } = await readNewLines(file.path, file.size, cursors[key], 8_000_000);
    cursors[key] = cursor;
    const seen = new Set<string>();
    const fileName = path.basename(file.path);
    const sessionId = fileName.match(/sess_[A-Za-z0-9-]+/)?.[0] ?? fileName;
    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const response = entry.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;
      if (!usage || typeof usage !== "object") continue;
      const requestId = typeof entry.requestId === "string" ? entry.requestId : "";
      if (requestId) {
        if (seen.has(requestId)) continue;
        seen.add(requestId);
      }
      const input = num(usage.inputTokens);
      const output = num(usage.outputTokens);
      if (!input && !output) continue;
      const modelInfo = entry.model as Record<string, unknown> | undefined;
      const model = typeof modelInfo?.modelId === "string" ? modelInfo.modelId : undefined;
      const at =
        (typeof entry.completedAt === "string" && entry.completedAt) ||
        (typeof entry.startedAt === "string" && entry.startedAt) ||
        new Date().toISOString();
      records.push({
        at,
        source: "runtime-session",
        provider: model ? modelToProvider(model, vendors) ?? "runtime:zcode" : "runtime:zcode",
        model,
        runtime: "zcode",
        kind: sessionId,
        inputTokens: input,
        outputTokens: output,
        totalTokens: num(usage.totalTokens) || input + output,
        details: cleanDetails({ cacheReadTokens: num(usage.cacheReadTokens), cacheWriteTokens: num(usage.cacheWriteTokens) }),
      });
    }
  }
}

/* ------------------------------------ Codex ------------------------------------ */

interface CodexTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cached: number;
  reasoning: number;
  at: string;
}

function lastTokenCount(lines: string[]): CodexTotals | null {
  let last: CodexTotals | null = null;
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = entry.payload as Record<string, unknown> | undefined;
    const info = (payload as { info?: { total_token_usage?: unknown } } | undefined)?.info;
    const usage = info && typeof info === "object" ? (info.total_token_usage as Record<string, unknown> | undefined) : undefined;
    if (payload?.type !== "token_count" || !usage || typeof usage !== "object") continue;
    last = {
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      totalTokens: num(usage.total_tokens),
      cached: num(usage.cached_input_tokens),
      reasoning: num(usage.reasoning_output_tokens),
      at: typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
    };
  }
  return last;
}

async function collectCodex(
  roots: string[],
  cursors: Record<string, number>,
  cumulative: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>,
  records: UsageRecord[],
): Promise<void> {
  const files: FileInfo[] = [];
  for (const root of roots) {
    files.push(...(await listTranscriptFiles(root, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"), 5, 300)));
  }
  for (const file of files) {
    const key = `codex:${file.path}`;
    // курсор codex - mtime файла: не изменившиеся файлы не читаются
    if (cursors[key] === file.mtimeMs) continue;
    const totals = await lastTokenCount(await readTail(file.path, file.size, 64_000));
    cursors[key] = file.mtimeMs;
    if (!totals) continue;
    const fileName = path.basename(file.path);
    const session = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? fileName;
    const previous = cumulative[key];
    const current = { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, totalTokens: totals.totalTokens };
    const delta = {
      input: previous ? Math.max(0, totals.inputTokens - previous.inputTokens) : totals.inputTokens,
      output: previous ? Math.max(0, totals.outputTokens - previous.outputTokens) : totals.outputTokens,
    };
    if (delta.input || delta.output) {
      records.push({
        at: totals.at,
        source: "runtime-session",
        provider: "runtime:codex",
        runtime: "codex",
        kind: session,
        inputTokens: delta.input,
        outputTokens: delta.output,
        totalTokens: delta.input + delta.output,
        details: cleanDetails({ cachedInputTokens: totals.cached, reasoningOutputTokens: totals.reasoning }),
      });
    }
    cumulative[key] = current;
  }
}

export interface RuntimeUsageOptions {
  home?: string;
  /** Тесты подменяют каталоги рантаймов временными фикстурами. */
  claudeDir?: string;
  codexDirs?: string[];
  zcodeDir?: string;
}

/** Сбор usage всех рантаймов: читает новые части транскриптов, пишет дельты. */
export async function collectRuntimeUsage(repoRoot: string, opts: RuntimeUsageOptions = {}): Promise<number> {
  const home = opts.home ?? homedir();
  const store = await readProviderUsage(repoRoot);
  const cursors = { ...store.cursors };
  const cumulative = { ...store.cumulative };
  const vendors = await vendorModelIndex(repoRoot);
  const records: UsageRecord[] = [];

  await collectClaude(opts.claudeDir ?? path.join(home, ".claude", "projects"), cursors, vendors, records);
  await collectZcode(opts.zcodeDir ?? path.join(home, ".zcode", "cli", "rollout"), cursors, vendors, records);
  await collectCodex(
    opts.codexDirs ?? [path.join(home, ".codex", "sessions"), path.join(home, ".codex", "archived_sessions")],
    cursors,
    cumulative,
    records,
  );

  await applyUsageCollection(repoRoot, { records, cursors, cumulative });
  return records.length;
}
