// Реестр чувствительных значений сессии. Значения попадают в реестр
// явно (learn) и редактируются во всех текстах, уходящих в модель и
// возвращающихся из неё, включая закодированные варианты.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface RegistryEntry {
  field: string;
  value: string;
  learnedAt: number;
}

export function encodedVariants(value: string): string[] {
  if (!value) return [];
  const variants = new Set<string>();
  variants.add(Buffer.from(value, "utf8").toString("base64"));
  variants.add(Buffer.from(value, "utf8").toString("hex"));
  variants.add(Array.from(value).join(" "));
  variants.add(value.replace(/[A-Za-z]/g, (character) => {
    const base = character <= "Z" ? 65 : 97;
    return String.fromCharCode(((character.charCodeAt(0) - base + 13) % 26) + base);
  }));
  variants.add(Array.from(value).map((character) => {
    const code = character.codePointAt(0)!;
    return code > 127 ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }).join(""));
  variants.add(encodeURIComponent(value));
  variants.delete(value);
  return [...variants];
}

export class SessionRegistry {
  private entries = new Map<string, RegistryEntry>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  learn(field: string, value: string): void {
    const trimmed = value.trim();
    if (!field || trimmed.length < 2) return;
    this.sweep();
    this.entries.set(field, { field, value: trimmed, learnedAt: Date.now() });
  }

  forget(field: string): void {
    this.entries.delete(field);
  }

  entriesSnapshot(): RegistryEntry[] {
    this.sweep();
    return [...this.entries.values()];
  }

  /** Пары (метка замены, строка для поиска) по всем значениям и вариантам. */
  replacementMap(): Array<{ tag: string; needle: string }> {
    const result: Array<{ tag: string; needle: string }> = [];
    for (const entry of this.entriesSnapshot()) {
      result.push({ tag: `session:${entry.field}`, needle: entry.value });
      for (const variant of encodedVariants(entry.value)) {
        result.push({ tag: `session:${entry.field}_encoded`, needle: variant });
      }
    }
    return result.sort((a, b) => b.needle.length - a.needle.length);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [field, entry] of this.entries) {
      if (now - entry.learnedAt > this.ttlMs) this.entries.delete(field);
    }
  }
}

/** Общий реестр процесса: консоль и обёртки используют один экземпляр. */
export const defaultRegistry = new SessionRegistry();
