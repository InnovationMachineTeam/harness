import { openSync, readSync, closeSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import { readDecisions } from "@harness/guardrails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TAIL_BYTES = 256 * 1024;
const MAX_EVENTS = 100;

/** Читает хвост журнала решений без загрузки всего файла. */
function readTail(file: string, bytes: number): string {
  const size = statSync(file).size;
  const length = Math.min(bytes, size);
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(file, "r");
  try {
    readSync(descriptor, buffer, 0, length, size - length);
  } finally {
    closeSync(descriptor);
  }
  const text = buffer.toString("utf8");
  // Первый обрезанный хвостом line отбрасывается.
  return text.slice(text.indexOf("\n") + 1);
}

interface EventLike {
  at?: string;
  effect?: string;
  ruleId?: string | null;
  integrationId?: string;
  latencyMs?: number;
  exceptionId?: string | null;
}

interface TopRow {
  name: string;
  count: number;
}

function topRows(counts: Map<string, number>, limit: number): TopRow[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/** Агрегаты за 7 дней по всему журналу (включая резервную копию ротации). */
function aggregates(repoRoot: string): Record<string, unknown> | null {
  try {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const events = readDecisions(repoRoot)
      .map((raw) => raw as EventLike)
      .filter((event) => event.at && Date.parse(event.at) >= since);
    if (!events.length) return { total: 0 };
    const effects = new Map<string, number>();
    const rules = new Map<string, number>();
    const integrations = new Map<string, number>();
    const latencies: number[] = [];
    let exceptions = 0;
    for (const event of events) {
      effects.set(event.effect ?? "unknown", (effects.get(event.effect ?? "unknown") ?? 0) + 1);
      if (event.ruleId) rules.set(event.ruleId, (rules.get(event.ruleId) ?? 0) + 1);
      if (event.integrationId) integrations.set(event.integrationId, (integrations.get(event.integrationId) ?? 0) + 1);
      if (event.exceptionId) exceptions++;
      if (typeof event.latencyMs === "number") latencies.push(event.latencyMs);
    }
    latencies.sort((a, b) => a - b);
    return {
      total: events.length,
      byEffect: Object.fromEntries(effects),
      topRules: topRows(rules, 5),
      topIntegrations: topRows(integrations, 5),
      exceptions,
      p95LatencyMs: latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null,
    };
  } catch {
    return null;
  }
}

/** GET /api/guardrails/events — последние решения Guardrails из audit/events.jsonl. */
export function GET() {
  const repoRoot = findRepoRoot();
  const file = join(repoRoot, ".guardrails", "audit", "events.jsonl");
  try {
    const stats = aggregates(repoRoot);
    if (!existsSync(file)) return NextResponse.json({ events: [], truncated: false, aggregates: stats });
    const tail = readTail(file, MAX_TAIL_BYTES);
    const lines = tail.split("\n").filter(Boolean);
    const events = lines.slice(-MAX_EVENTS).reverse().map((line) => {
      try { return JSON.parse(line) as unknown; }
      catch { return { effect: "unknown", reason: "неразбираемая запись журнала" }; }
    });
    return NextResponse.json({ events, truncated: lines.length > events.length, aggregates: stats });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
