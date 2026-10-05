import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Оцениватель исключений: временные, персонально одобренные послабления
// для отдельных правил. Файлы - .guardrails/exceptions/EX-YYYY-NNNN.json
// по схеме schemas/exception.schema.json. Просроченные исключения
// игнорируются; применение всегда фиксируется в журнале решений.

export interface GuardException {
  id: string;
  ruleId: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
  scope?: {
    tools?: string[];
    pathPattern?: string;
    commandPattern?: string;
  };
}

export interface ExceptionLoadResult {
  active: GuardException[];
  expired: GuardException[];
  errors: string[];
}

const ID_PATTERN = /^EX-\d{4}-\d{3,}$/;

export function parseException(raw: string, file: string): { exception?: GuardException; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: `${file}: некорректный JSON` };
  }
  const source = data as Record<string, unknown>;
  for (const field of ["id", "ruleId", "reason", "approvedBy", "expiresAt"]) {
    if (typeof source[field] !== "string" || !(source[field] as string).trim()) return { error: `${file}: отсутствует поле ${field}` };
  }
  const exception: GuardException = {
    id: source.id as string,
    ruleId: source.ruleId as string,
    reason: source.reason as string,
    approvedBy: source.approvedBy as string,
    expiresAt: source.expiresAt as string,
    scope: (source.scope as GuardException["scope"]) ?? undefined,
  };
  if (!ID_PATTERN.test(exception.id)) return { error: `${file}: id не соответствует EX-YYYY-NNNN` };
  if (Number.isNaN(Date.parse(exception.expiresAt))) return { error: `${file}: expiresAt не дата ISO` };
  return { exception };
}

/** Читает каталог исключений; отсутствующий каталог означает пустой набор. */
export function loadExceptions(repoRoot: string, now = new Date()): ExceptionLoadResult {
  const dir = join(repoRoot, ".guardrails", "exceptions");
  const result: ExceptionLoadResult = { active: [], expired: [], errors: [] };
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const parsed = parseException(readFileSync(join(dir, file), "utf8"), file);
    if (parsed.error || !parsed.exception) {
      result.errors.push(parsed.error!);
      continue;
    }
    if (Date.parse(parsed.exception.expiresAt) < now.getTime()) result.expired.push(parsed.exception);
    else result.active.push(parsed.exception);
  }
  return result;
}

/** Применяется ли исключение к решению: ruleId обязателен, scope сужает область. */
export function exceptionMatches(exception: GuardException, target: { ruleId: string; tool?: string; path?: string; command?: string }): boolean {
  if (exception.ruleId !== target.ruleId) return false;
  const scope = exception.scope;
  if (!scope) return true;
  if (scope.tools && (!target.tool || !scope.tools.includes(target.tool))) return false;
  if (scope.pathPattern && (!target.path || !new RegExp(scope.pathPattern, "i").test(target.path))) return false;
  if (scope.commandPattern && (!target.command || !new RegExp(scope.commandPattern, "i").test(target.command))) return false;
  return true;
}

/** Первое подходящее активное исключение для решения. */
export function findException(repoRoot: string, target: { ruleId: string; tool?: string; path?: string; command?: string }, now = new Date()): GuardException | null {
  const { active } = loadExceptions(repoRoot, now);
  return active.find((exception) => exceptionMatches(exception, target)) ?? null;
}
