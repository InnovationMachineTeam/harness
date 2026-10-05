import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Бюджеты N-2: SessionStart не дольше 2 с, PreToolUse не дольше 200 мс в среднем,
// UserPromptSubmit не дольше 3 с и не больше 4 КБ.
export interface BudgetRule {
  avgMs: number;
  maxBytes?: number;
}

export const HOOK_BUDGETS: Record<string, BudgetRule> = {
  "serena/session-start": { avgMs: 2000 },
  "serena/session-end": { avgMs: 2000 },
  "serena/remind": { avgMs: 200 },
  "graphify/guard-search": { avgMs: 200 },
  "graphify/guard-read": { avgMs: 200 },
  "pretooluse": { avgMs: 200 },
  "codegraph/prompt-hook": { avgMs: 3000, maxBytes: 4096 },
};

const DEFAULT_AVG_MS = 200;
const WINDOW_DAYS = 7;

export interface LogRow {
  iso: string;
  name: string;
  ms: number;
  bytes: number;
}

export function parseLog(text: string): LogRow[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [iso, name, ms, bytes] = line.split(" ");
      return { iso, name, ms: Number(ms), bytes: Number(bytes) };
    })
    .filter((row) => Boolean(row.iso && row.name) && Number.isFinite(row.ms) && Number.isFinite(row.bytes));
}

export function hookBudgetReport(root: string, nowMs: number = Date.now()): string[] {
  const file = join(root, ".agents", ".tmp", "hooks", "hooks.log");
  if (!existsSync(file)) return [];
  const cutoff = nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const groups = new Map<string, LogRow[]>();
  for (const row of parseLog(readFileSync(file, "utf8"))) {
    const ts = Date.parse(row.iso);
    if (!Number.isFinite(ts) || ts < cutoff || ts > nowMs) continue;
    const group = groups.get(row.name) ?? [];
    group.push(row);
    groups.set(row.name, group);
  }
  const problems: string[] = [];
  for (const [name, group] of groups) {
    const budget = HOOK_BUDGETS[name] ?? { avgMs: DEFAULT_AVG_MS };
    const avg = group.reduce((sum, row) => sum + row.ms, 0) / group.length;
    if (avg > budget.avgMs) problems.push(`${name}: avg=${Math.round(avg)}ms выше бюджета ${budget.avgMs}ms`);
    if (budget.maxBytes) {
      const maxBytes = Math.max(...group.map((row) => row.bytes));
      if (maxBytes > budget.maxBytes) problems.push(`${name}: bytes=${maxBytes} выше бюджета ${budget.maxBytes}`);
    }
  }
  return problems;
}
