import { NextResponse } from "next/server";
import { loadConsoleState } from "@/core/state";
import { ensureSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore } from "@/core/sessionsIndex/store";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/search?q=&runtime=&dir=&limit=
 * Полнотекстовый поиск по сообщениям сессий (FTS5 индекса sessions.sqlite;
 * без FTS5 в сборке SQLite - LIKE-фолбэк). При settings.sessionIndex.
 * contentSearch=false тексты в индекс не пишутся - отдаётся только поиск
 * по метаданным (заголовок, папки) с признаком metaOnly.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const runtime = params.get("runtime") ?? undefined;
  const dir = params.get("dir") ?? undefined;
  const limitParam = Number(params.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
  if (q.length < 2) {
    return NextResponse.json({ query: q, fts: false, metaOnly: false, hits: [] });
  }

  // свежесть индекса перед поиском (ленивый сбор, без force)
  await ensureSessionsIndex(ctx.repoRoot).catch(() => 0);
  const state = await loadConsoleState(ctx.repoRoot);
  const contentSearch = state.settings.sessionIndex.contentSearch;

  try {
    const store = new SessionIndexStore(ctx.repoRoot);
    const filter = { runtime: runtime || undefined, dir: dir || undefined, limit };
    const result = store.search(q, filter);
    let hits = result.hits;
    let metaOnly = false;
    if (!contentSearch || hits.length === 0) {
      // contentSearch выключен (или в текстах пусто) - поиск по метаданным
      const meta = store.searchMeta(q, filter).map((row) => ({
        runtime: row.runtime,
        sessionId: row.sessionId,
        title: row.title,
        workspaceDir: row.workspaceDir,
        role: "session",
        at: row.lastActivityAt,
        snippet: [row.title, row.workspaceDir ?? row.projectDir].filter(Boolean).join(" · "),
      }));
      if (!contentSearch || meta.length > 0) {
        metaOnly = !contentSearch;
        hits = meta.slice(0, limit);
      }
    }
    store.close();
    return NextResponse.json({ query: q, fts: result.fts, metaOnly, hits });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
