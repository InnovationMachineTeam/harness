import { join } from "node:path";
import type { FileEntry, ProbeContext, SessionDetail, SessionMessage, SessionSummary } from "@/core/types";

/** Слаги рабочих папок: /Users/x/proj → -Users-x-proj (каталог в ~/.claude/projects). */
export function claudeProjectSlug(dir: string): string {
  return dir.replace(/\/+$/, "").replaceAll("/", "-");
}

/** Извлечь текст из content записи Claude (строка или массив блоков). */
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

function parseJsonLines(chunk: string, maxLines = 200): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of chunk.split("\n").slice(-maxLines)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      /* обрезанная строка в начале/конце чанка - пропускаем */
    }
  }
  return out;
}

async function sessionFiles(ctx: ProbeContext, dirs: string[]): Promise<(FileEntry & { workspaceDir: string })[]> {
  const out: (FileEntry & { workspaceDir: string })[] = [];
  for (const dir of dirs) {
    const files = await ctx.fs.collectFiles(join(ctx.home, ".claude", "projects", claudeProjectSlug(dir)), {
      match: (n) => n.endsWith(".jsonl"),
      maxDepth: 1,
      limit: 100,
    });
    out.push(...files.map((f) => ({ ...f, workspaceDir: dir })));
  }
  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export async function listClaudeSessions(ctx: ProbeContext, dirs: string[]): Promise<SessionSummary[]> {
  const files = await sessionFiles(ctx, dirs);
  return files.slice(0, 50).map((f) => ({
    id: f.name.replace(/\.jsonl$/, ""),
    runtime: "claude",
    lastActivityAt: f.mtime.toISOString(),
    workspaceDir: f.workspaceDir,
    sizeBytes: 0,
    resumable: true,
  }));
}

export async function getClaudeSession(ctx: ProbeContext, id: string, dirs: string[]): Promise<SessionDetail | null> {
  const file = (await sessionFiles(ctx, dirs)).find((f) => f.name === `${id}.jsonl`);
  if (!file) return null;
  const head = await ctx.fs.readFirstChunk(file.path, 96_000);
  const excerpt: SessionMessage[] = [];
  for (const rec of parseJsonLines(head, 400)) {
    const type = rec.type;
    if (type !== "user" && type !== "assistant") continue;
    const message = rec.message as { content?: unknown } | undefined;
    const text = claudeText(message?.content).trim();
    if (!text) continue;
    excerpt.push({
      role: type === "user" ? "user" : "assistant",
      text: text.slice(0, 800),
      ts: typeof rec.timestamp === "string" ? rec.timestamp : undefined,
    });
    if (excerpt.length >= 30) break;
  }
  const title = excerpt.find((m) => m.role === "user")?.text;
  return {
    summary: {
      id,
      runtime: "claude",
      lastActivityAt: file.mtime.toISOString(),
      workspaceDir: file.workspaceDir,
      titleHint: title?.slice(0, 120),
      sizeBytes: 0,
      resumable: true,
    },
    excerpt,
    file: `~/.claude/projects/${claudeProjectSlug(file.workspaceDir)}/${file.name}`,
  };
}

/**
 * Ожидание ввода: последний ход ассистента завершён (последняя запись -
 * assistant), файл не изменяется ≥ 2 минут, CLI-процессы работают.
 */
export async function claudeAwaiting(ctx: ProbeContext): Promise<{
  sessionId: string;
  since: string;
  question?: string;
} | null> {
  const files = await sessionFiles(ctx, ctx.workspaces);
  const newest = files.find((f) => Date.now() - f.mtime.getTime() < 6 * 3600_000);
  if (!newest || Date.now() - newest.mtime.getTime() < 2 * 60_000) return null;
  const tail = await ctx.fs.readLastChunk(newest.path, 16_000);
  const records = parseJsonLines(tail, 20);
  const last = records.at(-1);
  if (!last || last.type !== "assistant") return null;
  const message = last.message as { content?: unknown } | undefined;
  const question = claudeText(message?.content).trim().slice(-300);
  return {
    sessionId: newest.name.replace(/\.jsonl$/, ""),
    since: newest.mtime.toISOString(),
    question: question || undefined,
  };
}
