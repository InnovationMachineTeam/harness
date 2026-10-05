import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Многоходовой сбор персональных данных: каждый ход выглядит безобидно,
// счётчик зондов по сессии накапливается и на пороге сессия блокируется.
// Состояние хранится в .agents/.tmp (без raw-текста промптов), ключом
// служит SHA-256 идентификатора сессии.

export const MAX_PII_PROBES = 3;

/** Записи зондов старше TTL считаются остывшей сессией и отбрасываются. */
export const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

/** Паттерны зонда: запрос персональных данных или их фрагментов. */
export const PROBE_PATTERNS: RegExp[] = [
  /\b(?:what'?s|what\s+is|which\s+is|tell\s+me|give\s+me)\s+(?:my|the|their)\s+(?:name|email|account|phone|address|ssn)\b/i,
  /\b(?:first|last|middle)\s+(?:letter|character|char)\b/i,
  /\b(?:spell|read|say|tell)[^.\n]{0,30}(?:letter|character)\s+(?:by|at a time|one)\b/i,
  /\b(?:what|which)[^.\n]{0,20}(?:letter|character)[^.\n]{0,20}(?:position|index|number)\b/i,
  /\b(?:confirm|verify)[^.\n]{0,30}\b(?:email|name|account|phone)\b/i,
  /\bread\s+(?:it\s+)?back\b/i,
  /\b(?:starts?|ends?|begins?)\s+with\b[^.\n]{0,30}\b(?:email|name|account)\b/i,
  /(?<![\p{L}])как\s+меня\s+зовут(?![\p{L}])|(?<![\p{L}])какой\s+у\s+меня|(?<![\p{L}])назовите\s+мо[йя]|(?<![\p{L}])мо[йя]\s+(?:email|электронн[\p{L}]*|почт[\p{L}]*|телефон|адрес|номер\s+(?:счёта|аккаунта|телефона))/iu,
  /(?<![\p{L}])(?:по\s+буквам|по\s+одной\s+букве|первая\s+буква|последняя\s+буква)(?![\p{L}])/iu,
  /(?<![\p{L}])подтвердите?\s+мо[йя]\s+(?:email|почт[\p{L}]*|адрес|номер|имя)/iu,
];

export interface ProbeState {
  count: number;
  fields: string[];
  updatedAt: number;
}

export interface ProbeVerdict {
  isProbe: boolean;
  fieldHint: string | null;
  count: number;
  blocked: boolean;
}

export function probeMatches(text: string): string | null {
  for (const pattern of PROBE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].toLowerCase().slice(0, 80);
  }
  return null;
}

/** Хранилище счётчиков зондов; каталог создаётся при первой записи. */
export class ProbeStore {
  private readonly file: string;

  constructor(root: string) {
    this.file = join(root, ".agents", ".tmp", "guardrails", "probes.json");
  }

  private load(): Record<string, ProbeState> {
    try {
      if (!existsSync(this.file)) return {};
      const states = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, ProbeState>;
      const now = Date.now();
      for (const [id, state] of Object.entries(states)) {
        if (!state.updatedAt || now - state.updatedAt > PROBE_TTL_MS) delete states[id];
      }
      return states;
    } catch {
      return {};
    }
  }

  private save(states: Record<string, ProbeState>): void {
    mkdirSync(this.file.slice(0, this.file.lastIndexOf("/")), { recursive: true });
    writeFileSync(this.file, JSON.stringify(states), { encoding: "utf8", mode: 0o600 });
  }

  private key(sessionId: string): string {
    return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  }

  /** Фиксирует зонд и возвращает вердикт; блокирует на пороге MAX_PII_PROBES. */
  record(sessionId: string, text: string): ProbeVerdict {
    const fieldHint = probeMatches(text);
    if (!fieldHint) return { isProbe: false, fieldHint: null, count: 0, blocked: false };
    const states = this.load();
    const id = this.key(sessionId);
    const state = states[id] ?? { count: 0, fields: [], updatedAt: 0 };
    state.count += 1;
    if (!state.fields.includes(fieldHint)) state.fields.push(fieldHint);
    state.updatedAt = Date.now();
    states[id] = state;
    this.save(states);
    return { isProbe: true, fieldHint, count: state.count, blocked: state.count >= MAX_PII_PROBES };
  }

  reset(sessionId?: string): void {
    if (!sessionId) {
      if (existsSync(this.file)) writeFileSync(this.file, "{}", { encoding: "utf8", mode: 0o600 });
      return;
    }
    const states = this.load();
    delete states[this.key(sessionId)];
    this.save(states);
  }
}
