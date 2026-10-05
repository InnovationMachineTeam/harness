#!/usr/bin/env bun
// Статистика решений Guardrails по журналу. Использование:
//   bun .guardrails/src/decisions.ts                 - за 7 дней
//   bun .guardrails/src/decisions.ts --days 30       - свой период
//   bun .guardrails/src/decisions.ts --limit 10      - строк в разрезах
// Источник - .guardrails/audit/events.jsonl и его резервная копия.

import { readDecisions } from "./audit-log";

interface DecisionEvent {
  at?: string;
  effect?: string;
  ruleId?: string | null;
  integrationId?: string;
  latencyMs?: number;
  exceptionId?: string | null;
}

function top(counts: Map<string, number>, limit: number): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function print(title: string, rows: Array<[string, number]>): void {
  if (!rows.length) return;
  console.log(`${title}:`);
  for (const [name, count] of rows) console.log(`  ${String(count).padStart(5)}\t${name}`);
}

function main(): never {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const days = Number(value("--days") ?? 7);
  const limit = Number(value("--limit") ?? 5);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const events = readDecisions(process.cwd())
    .map((raw) => raw as DecisionEvent)
    .filter((event) => {
      if (!event.at) return false;
      const parsed = Date.parse(event.at);
      return !Number.isNaN(parsed) && parsed >= since;
    });

  if (!events.length) {
    console.log(`decisions: событий за ${days} дн. нет`);
    process.exit(0);
  }

  const latencies = events.map((event) => event.latencyMs).filter((value): value is number => typeof value === "number");
  const effects = new Map<string, number>();
  const rules = new Map<string, number>();
  const integrations = new Map<string, number>();
  let exceptions = 0;
  for (const event of events) {
    effects.set(event.effect ?? "unknown", (effects.get(event.effect ?? "unknown") ?? 0) + 1);
    if (event.ruleId) rules.set(event.ruleId, (rules.get(event.ruleId) ?? 0) + 1);
    if (event.integrationId) integrations.set(event.integrationId, (integrations.get(event.integrationId) ?? 0) + 1);
    if (event.exceptionId) exceptions++;
  }

  console.log(`decisions: событий ${events.length} за ${days} дн. (исключений применено: ${exceptions})`);
  print("По решениям", [...effects.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  print("По правилам", top(rules, limit));
  print("По точкам применения", top(integrations, limit));
  if (latencies.length) {
    const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(`Задержка: средняя ${avg.toFixed(1)} мс, p95 ${sorted[Math.floor(sorted.length * 0.95)]} мс`);
  }
  process.exit(0);
}

if (import.meta.main) main();
