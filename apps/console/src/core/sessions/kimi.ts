import { join } from "node:path";
import type { ProbeContext, SessionDetail, SessionSummary } from "@/core/types";

interface KimiIndexEntry {
  sessionId: string;
  sessionDir: string;
  workDir: string;
}

async function readIndex(ctx: ProbeContext): Promise<KimiIndexEntry[]> {
  const text = await ctx.fs.readText(join(ctx.home, ".kimi-code", "session_index.jsonl"), 512_000);
  if (!text) return [];
  const out: KimiIndexEntry[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as Partial<KimiIndexEntry>;
      if (rec.sessionId && rec.sessionDir && rec.workDir) {
        out.push({ sessionId: rec.sessionId, sessionDir: rec.sessionDir, workDir: rec.workDir });
      }
    } catch {
      /* пропускаем повреждённые строки */
    }
  }
  return out;
}

interface KimiMeta {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  mtime: Date;
}

async function readMeta(ctx: ProbeContext, entry: KimiIndexEntry): Promise<KimiMeta | null> {
  // sessionDir в индексе обычно уже включает подкаталог session_<uuid>,
  // но на всякий случай проверяем оба варианта расположения state.json
  const candidates = [
    join(entry.sessionDir, "state.json"),
    join(entry.sessionDir, entry.sessionId, "state.json"),
  ];
  let stateFile: string | null = null;
  let mtime: Date | null = null;
  for (const candidate of candidates) {
    mtime = await ctx.fs.mtimeOf(candidate);
    if (mtime) {
      stateFile = candidate;
      break;
    }
  }
  if (!stateFile || !mtime) return null;
  const text = await ctx.fs.readText(stateFile, 8_000);
  let title: string | undefined;
  let createdAt: string | undefined;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { title?: string; createdAt?: string };
      title = typeof parsed.title === "string" && parsed.title !== "New Session" ? parsed.title : undefined;
      createdAt = parsed.createdAt;
    } catch {
      /* meta опциональна */
    }
  }
  return { title, createdAt, mtime };
}

export async function listKimiSessions(ctx: ProbeContext, dirs: string[]): Promise<SessionSummary[]> {
  const entries = await readIndex(ctx);
  const out: SessionSummary[] = [];
  for (const entry of entries) {
    if (dirs.length > 0 && !dirs.includes(entry.workDir)) continue;
    const meta = await readMeta(ctx, entry);
    if (!meta) continue;
    out.push({
      id: entry.sessionId,
      runtime: "kimi",
      startedAt: meta.createdAt ?? undefined,
      lastActivityAt: (meta.updatedAt ? new Date(meta.updatedAt) : meta.mtime).toISOString(),
      workspaceDir: entry.workDir,
      titleHint: meta.title,
      sizeBytes: 0,
      resumable: true,
    });
  }
  return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 50);
}

export async function getKimiSession(ctx: ProbeContext, id: string): Promise<SessionDetail | null> {
  const entry = (await readIndex(ctx)).find((e) => e.sessionId === id);
  if (!entry) return null;
  const meta = await readMeta(ctx, entry);
  if (!meta) return null;
  return {
    summary: {
      id,
      runtime: "kimi",
      startedAt: meta.createdAt ?? undefined,
      lastActivityAt: (meta.updatedAt ? new Date(meta.updatedAt) : meta.mtime).toISOString(),
      workspaceDir: entry.workDir,
      titleHint: meta.title,
      sizeBytes: 0,
      resumable: true,
    },
    excerpt: [],
    file: `~/.kimi-code/…/${entry.sessionDir.split("/").pop()}/${entry.sessionId}/state.json`,
  };
}

/** Список рабочих папок, известных Kimi (для подсказок в UI рабочих папок). */
export async function kimiKnownWorkdirs(ctx: ProbeContext): Promise<string[]> {
  const entries = await readIndex(ctx);
  return [...new Set(entries.map((e) => e.workDir))];
}
