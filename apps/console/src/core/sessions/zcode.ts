import { join } from "node:path";
import type { FileEntry, ProbeContext, SessionDetail, SessionSummary } from "@/core/types";

/** Сессии ZCode: model-io-логи в ~/.zcode/cli/rollout (без привязки к папке). */
function isMainSession(name: string): boolean {
  return name.startsWith("model-io-sess_") && !name.includes("subagent");
}

function sessionIdOf(name: string): string {
  return name.match(/sess_[A-Za-z0-9-]+/)?.[0] ?? name;
}

async function rollouts(ctx: ProbeContext): Promise<FileEntry[]> {
  return ctx.fs.collectFiles(join(ctx.home, ".zcode", "cli", "rollout"), {
    match: (n) => n.endsWith(".jsonl") && isMainSession(n),
    maxDepth: 1,
    limit: 100,
  });
}

export async function listZcodeSessions(ctx: ProbeContext): Promise<SessionSummary[]> {
  const files = await rollouts(ctx);
  const plans = await ctx.fs.collectFiles(join(ctx.repoRoot, ".zcode", "plans"), {
    match: (n) => n.startsWith("plan-") && n.endsWith(".md"),
    maxDepth: 1,
    limit: 100,
  });
  const planSessions = new Set(plans.map((p) => p.name.match(/sess_[A-Za-z0-9-]+/)?.[0]).filter(Boolean) as string[]);

  return files
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, 50)
    .map((f) => {
      const id = sessionIdOf(f.name);
      return {
        id,
        runtime: "zcode",
        lastActivityAt: f.mtime.toISOString(),
        // план в репозитории связывает сессию с этой рабочей папкой
        workspaceDir: planSessions.has(id) ? ctx.repoRoot : undefined,
        sizeBytes: 0,
        resumable: true,
      } satisfies SessionSummary;
    });
}

export async function getZcodeSession(ctx: ProbeContext, id: string): Promise<SessionDetail | null> {
  const file = (await rollouts(ctx)).find((f) => sessionIdOf(f.name) === id);
  if (!file) return null;
  // первая строка лога содержит startedAt первого хода
  const head = await ctx.fs.readText(file.path, 2_000);
  let startedAt: string | undefined;
  if (head) {
    try {
      const first = JSON.parse(head.split("\n", 1)[0]) as { startedAt?: unknown };
      if (typeof first.startedAt === "string") startedAt = first.startedAt;
    } catch {
      /* опционально */
    }
  }
  return {
    summary: {
      id,
      runtime: "zcode",
      startedAt,
      lastActivityAt: file.mtime.toISOString(),
      sizeBytes: 0,
      resumable: true,
    },
    // содержимое model-io-лога - сырые запросы/ответы модели, не человекочитаемый
    // транскрипт; показываем только метаданные
    excerpt: [],
    file: `~/.zcode/cli/rollout/${file.name}`,
  };
}

/** Ожидание ввода: последний ход завершён (completedAt), файл не изменяется, процессы работают. */
export async function zcodeAwaiting(ctx: ProbeContext): Promise<{
  sessionId: string;
  since: string;
  question?: string;
} | null> {
  const files = await rollouts(ctx);
  const newest = files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
  if (!newest) return null;
  const age = Date.now() - newest.mtime.getTime();
  if (age < 2 * 60_000 || age > 6 * 3600_000) return null;
  const tail = await ctx.fs.readLastChunk(newest.path, 8_000);
  const lines = tail.split("\n").filter((l) => l.trim());
  const last = lines.at(-1);
  if (!last) return null;
  try {
    const rec = JSON.parse(last) as { completedAt?: unknown };
    if (typeof rec.completedAt !== "string") return null;
  } catch {
    return null;
  }
  return { sessionId: sessionIdOf(newest.name), since: newest.mtime.toISOString() };
}
