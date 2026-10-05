import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import policy from "../policy.json";

// Общий писатель журнала решений с ротацией: при превышении предела
// текущий файл переименовывается в events.jsonl.1 (предыдущий .1
// перезаписывается), хранится одна резервная копия. Входная точка cli.ts
// пока пишет напрямую и подключается к ротации отдельным одобренным
// изменением; PostToolUse и scan-history используют этот модуль.

export const MAX_LOG_BYTES = 1024 * 1024;

export function eventsPath(repo: string): string {
  return resolve(repo, policy.audit.events);
}

/** Дописывает событие; перед записью ротирует файл, если он превысил предел. */
export function appendDecision(repo: string, event: Record<string, unknown>): void {
  const target = eventsPath(repo);
  try {
    if (existsSync(target) && statSync(target).size > MAX_LOG_BYTES) {
      renameSync(target, `${target}.1`);
    }
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {
    // Журнал не критичен для решения; сбой записи игнорируется.
  }
}

/** События журнала из резервной копии и текущего файла. */
export function readDecisions(repo: string): Record<string, unknown>[] {
  const target = eventsPath(repo);
  const decisions: Record<string, unknown>[] = [];
  for (const file of [`${target}.1`, target].filter(existsSync)) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        try {
          decisions.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // Неразбираемая строка пропускается.
        }
      }
    } catch {
      // Нечитаемый файл пропускается.
    }
  }
  return decisions;
}
