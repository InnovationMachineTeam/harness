import { join } from "node:path";
import type { ProbeContext, SessionDetail, SessionSummary } from "@/core/types";

/**
 * Сессии Antigravity: индекс CLI `~/.gemini/antigravity-cli/history.jsonl`
 * (свежие записи - в конце файла). Полный диалог остаётся в хранилище
 * Antigravity (IDE - protobuf `~/.gemini/antigravity/conversations/*.pb`,
 * CLI - SQLite cache) и консолью не парсится.
 */
interface AntigravityHistoryEntry {
  id: string;
  title?: string;
  updatedAt?: string;
  workDir?: string;
}

function firstString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

async function readHistory(ctx: ProbeContext): Promise<AntigravityHistoryEntry[]> {
  // свежие сессии - в конце файла, читаем хвост
  const tail = await ctx.fs.readLastChunk(join(ctx.home, ".gemini", "antigravity-cli", "history.jsonl"), 256_000);
  const out: AntigravityHistoryEntry[] = [];
  for (const line of tail.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as Record<string, unknown>;
      const id = firstString(rec, ["conversationId", "conversation_id", "id", "sessionId", "uuid"]);
      if (!id) continue;
      out.push({
        id,
        title: firstString(rec, ["title", "name", "titleText"]),
        updatedAt: firstString(rec, ["updatedAt", "updated_at", "lastModified", "last_modified", "timestamp"]),
        workDir: firstString(rec, ["workDir", "work_dir", "cwd", "workspacePath", "workspace"]),
      });
    } catch {
      /* пропускаем повреждённые строки */
    }
  }
  return out;
}

function toIso(value: string | undefined, fallback: Date): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

export async function listAntigravitySessions(ctx: ProbeContext, dirs: string[]): Promise<SessionSummary[]> {
  const historyPath = join(ctx.home, ".gemini", "antigravity-cli", "history.jsonl");
  const mtime = await ctx.fs.mtimeOf(historyPath);
  if (!mtime) return [];
  const entries = await readHistory(ctx);
  const out: SessionSummary[] = [];
  for (const entry of entries) {
    if (dirs.length > 0 && entry.workDir && !dirs.includes(entry.workDir)) continue;
    out.push({
      id: entry.id,
      runtime: "antigravity",
      startedAt: undefined,
      lastActivityAt: toIso(entry.updatedAt, mtime),
      workspaceDir: entry.workDir,
      titleHint: entry.title,
      sizeBytes: 0,
      resumable: true,
    });
  }
  return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 50);
}

export async function getAntigravitySession(ctx: ProbeContext, id: string): Promise<SessionDetail | null> {
  const historyPath = join(ctx.home, ".gemini", "antigravity-cli", "history.jsonl");
  const mtime = await ctx.fs.mtimeOf(historyPath);
  if (!mtime) return null;
  const entry = (await readHistory(ctx)).find((e) => e.id === id);
  if (!entry) return null;
  return {
    summary: {
      id,
      runtime: "antigravity",
      startedAt: undefined,
      lastActivityAt: toIso(entry.updatedAt, mtime),
      workspaceDir: entry.workDir,
      titleHint: entry.title,
      sizeBytes: 0,
      resumable: true,
    },
    excerpt: [],
    file: "~/.gemini/antigravity-cli/history.jsonl",
  };
}
