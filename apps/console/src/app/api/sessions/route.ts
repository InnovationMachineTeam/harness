import { NextResponse } from "next/server";
import type { RuntimeAdapter, SessionMetrics, SessionSummary } from "@/core/types";
import { workspaceDirs } from "@/core/state";
import { ensureSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore, type SessionIndexRow } from "@/core/sessionsIndex/store";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 500;

/** Метрики строки индекса в форму SessionSummary. */
function indexMetrics(row: SessionIndexRow): SessionMetrics {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheTokens: row.cacheTokens,
    costUsd: row.costUsd,
    pricingCoverage: row.pricingCoverage,
    durationMs: row.durationMs,
    models: row.models,
    messageCount: row.messageCount,
    toolCount: row.toolCount,
  };
}

/** Строка индекса как SessionSummary истории. */
function indexSummary(row: SessionIndexRow): SessionSummary {
  return {
    id: row.sessionId,
    runtime: row.runtime,
    startedAt: row.startedAt ?? undefined,
    lastActivityAt: row.lastActivityAt,
    workspaceDir: row.workspaceDir ?? row.projectDir ?? undefined,
    titleHint: row.title ?? undefined,
    sizeBytes: row.sizeBytes,
    turns: row.turns,
    resumable: true,
    metrics: indexMetrics(row),
  };
}

/**
 * GET /api/sessions?runtime=&dir=&id=&refresh=1
 * runtime - один рантайм или список через запятую; без параметра - все
 * рантаймы с историей сессий, объединённый список по свежести. Без id -
 * список сессий (dir фильтрует по рабочей папке), с id - детали/превью
 * (только при одном рантайме). refresh=1 - принудительный пересбор индекса
 * сессий (иначе ленивый сбор с TTL 5 минут).
 *
 * Список объединяет live-скан адаптеров (свежие сессии, ожидающие ввода) с
 * накопленной историей индекса sessions.sqlite: метрики из индекса
 * присоединяются к live-строкам, старые сессии добавляются из индекса.
 * Ошибки индекса не ломают выдачу live-скана.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const url = new URL(request.url);
  const runtimeParam = url.searchParams.get("runtime");
  const id = url.searchParams.get("id");
  const dir = url.searchParams.get("dir");
  const refresh = url.searchParams.get("refresh") === "1";
  const requested = (runtimeParam ? runtimeParam.split(",").map((value) => value.trim()) : Object.keys(ctx.adapters))
    .filter(Boolean);
  const resolved = requested.map((runtime) => ctx.adapters[runtime]);
  const missing = requested.filter((_, index) => !resolved[index]);
  if (missing.length > 0) {
    return NextResponse.json({ error: `неизвестный рантайм: ${missing[0]}` }, { status: 404 });
  }
  const capable = resolved.filter((adapter): adapter is RuntimeAdapter => Boolean(adapter?.listSessions && adapter?.getSession));
  if (id && capable.length !== 1) {
    return NextResponse.json({ error: "детали сессии доступны для одного рантайма" }, { status: 400 });
  }

  const dirs = dir ? [dir] : workspaceDirs(ctx.state);
  const probeCtx = {
    repoRoot: ctx.repoRoot,
    home: (await import("node:os")).homedir(),
    fs: (await import("@/lib/signals/fs")).fsSignals,
    workspaces: workspaceDirs(ctx.state),
  };

  if (id) {
    const detail = await capable[0]!.getSession!(probeCtx, id);
    if (!detail) return NextResponse.json({ error: "сессия не найдена" }, { status: 404 });
    // метрики сессии из индекса (могут отсутствовать - сессия ещё не собрана)
    try {
      const store = new SessionIndexStore(ctx.repoRoot);
      const row = store.getSession(capable[0]!.id, id);
      store.close();
      if (row) detail.summary.metrics = indexMetrics(row);
    } catch {
      /* индекс недоступен - детали без метрик */
    }
    return NextResponse.json({ supported: true, detail });
  }

  // ленивый накопительный сбор индекса; сбой не влияет на live-скан
  await ensureSessionsIndex(ctx.repoRoot, { force: refresh }).catch(() => 0);

  if (capable.length === 0) {
    return NextResponse.json({ supported: false, sessions: [] });
  }
  const lists = await Promise.all(capable.map((adapter) => adapter.listSessions!(probeCtx, dirs).catch(() => [])));
  const live = lists.flat();
  const sessions: SessionSummary[] = live;

  try {
    const store = new SessionIndexStore(ctx.repoRoot);
    const runtimeFilter = requested.length === 1 ? requested[0] : undefined;
    const rows = store.listSessions({ runtime: runtimeFilter, dir: dir ?? undefined, limit: LIST_LIMIT });
    const byKey = new Map(live.map((session) => [`${session.runtime}:${session.id}`, session]));
    for (const row of rows) {
      const key = `${row.runtime}:${row.sessionId}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.metrics = indexMetrics(row);
        existing.turns = existing.turns ?? row.turns;
      } else {
        byKey.set(key, indexSummary(row));
      }
    }
    store.close();
    sessions.length = 0;
    sessions.push(...byKey.values());
  } catch {
    /* индекс недоступен - только live-скан */
  }

  sessions.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return NextResponse.json({ supported: true, sessions: sessions.slice(0, LIST_LIMIT) });
}
