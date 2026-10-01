import { join } from "node:path";
import type { FileEntry, ProbeContext, SessionDetail, SessionMessage, SessionSummary } from "@/core/types";

/** rollout-2026-09-30T01-03-13-<uuid>.jsonl → Date начала сессии. Чистая функция. */
export function parseCodexRolloutStart(name: string): string | undefined {
  const m = name.match(/rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString();
}

async function rollouts(ctx: ProbeContext): Promise<FileEntry[]> {
  const roots = [join(ctx.home, ".codex", "sessions"), join(ctx.home, ".codex", "archived_sessions")];
  const out: FileEntry[] = [];
  for (const root of roots) {
    out.push(
      ...(await ctx.fs.collectFiles(root, {
        match: (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"),
        maxDepth: 5,
        limit: 150,
      })),
    );
  }
  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

function sessionIdOf(file: FileEntry, head: Record<string, unknown> | null): string {
  const payload = head?.payload as Record<string, unknown> | undefined;
  if (typeof payload?.session_id === "string" && payload.session_id) return payload.session_id;
  if (typeof head?.id === "string" && head.id) return head.id;
  return (file.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? file.name);
}

function cwdOf(head: Record<string, unknown> | null): string | null {
  const payload = head?.payload as Record<string, unknown> | undefined;
  if (typeof payload?.cwd === "string") return payload.cwd;
  if (typeof head?.cwd === "string") return head.cwd;
  return null;
}

export async function listCodexSessions(ctx: ProbeContext, dirs: string[]): Promise<SessionSummary[]> {
  const files = await rollouts(ctx);
  const out: SessionSummary[] = [];
  for (const f of files.slice(0, 80)) {
    const head = await ctx.fs.headJsonLine(f.path);
    const cwd = cwdOf(head);
    if (dirs.length > 0 && (!cwd || !dirs.includes(cwd))) continue;
    out.push({
      id: sessionIdOf(f, head),
      runtime: "codex",
      startedAt: parseCodexRolloutStart(f.name),
      lastActivityAt: f.mtime.toISOString(),
      workspaceDir: cwd ?? undefined,
      sizeBytes: 0,
      resumable: true,
    });
    if (out.length >= 50) break;
  }
  return out;
}

export async function getCodexSession(ctx: ProbeContext, id: string): Promise<SessionDetail | null> {
  const files = await rollouts(ctx);
  for (const f of files) {
    const head = await ctx.fs.headJsonLine(f.path);
    if (sessionIdOf(f, head) !== id) continue;
    const chunk = await ctx.fs.readFirstChunk(f.path, 96_000);
    const excerpt: SessionMessage[] = [];
    for (const rec of safeLines(chunk)) {
      const payload = rec.payload as Record<string, unknown> | undefined;
      if (!payload) continue;
      const ptype = payload.type;
      if (typeof ptype !== "string") continue;
      if (ptype === "user_message" || ptype === "agent_message" || ptype === "message") {
        const text = String(payload.message ?? "").trim();
        if (text) {
          excerpt.push({
            role: ptype === "user_message" ? "user" : "assistant",
            text: text.slice(0, 800),
            ts: typeof rec.timestamp === "string" ? rec.timestamp : undefined,
          });
        }
      }
      if (excerpt.length >= 30) break;
    }
    const cwd = cwdOf(head);
    return {
      summary: {
        id,
        runtime: "codex",
        startedAt: parseCodexRolloutStart(f.name),
        lastActivityAt: f.mtime.toISOString(),
        workspaceDir: cwd ?? undefined,
        titleHint: excerpt[0]?.text.slice(0, 120),
        sizeBytes: 0,
        resumable: true,
      },
      excerpt,
      file: `~/.codex/…/${f.relPath}`,
    };
  }
  return null;
}

function safeLines(chunk: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of chunk.split("\n").slice(0, 400)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      /* обрезанные строки пропускаем */
    }
  }
  return out;
}

/** Ожидание ввода: последнее событие task_complete, файл не изменяется, процессы работают. */
export async function codexAwaiting(ctx: ProbeContext): Promise<{
  sessionId: string;
  since: string;
  question?: string;
} | null> {
  const files = await rollouts(ctx);
  const newest = files[0];
  if (!newest || Date.now() - newest.mtime.getTime() < 2 * 60_000) return null;
  if (Date.now() - newest.mtime.getTime() > 6 * 3600_000) return null;
  const tail = await ctx.fs.readLastChunk(newest.path, 16_000);
  const records = safeLines(tail).slice(-5);
  const last = records.at(-1);
  const payload = last?.payload as Record<string, unknown> | undefined;
  if (!last || last.type !== "event_msg" || payload?.type !== "task_complete") return null;
  const head = await ctx.fs.headJsonLine(newest.path);
  return {
    sessionId: sessionIdOf(newest, head),
    since: newest.mtime.toISOString(),
    question:
      typeof payload.last_agent_message === "string" && payload.last_agent_message.trim()
        ? payload.last_agent_message.trim().slice(-300)
        : undefined,
  };
}
