import { patternsFor, type Surface } from "./patterns";
import type { SessionRegistry } from "../llm/session";

// Редактирование текста: замена чувствительных данных на плейсхолдеры.
// Журнал замен содержит только метки классов, не сами значения.

export interface RedactResult {
  text: string;
  /** Выполненные замены в форме "pattern:email" или "session:email_encoded". */
  applied: string[];
}

export interface RedactOptions {
  registry?: SessionRegistry | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Заменяет значения реестра сессии (включая закодированные варианты) и
 * паттерны поверхности. Для llm-io секреты тоже редактируются: модель не
 * должна ни получать их, ни возвращать.
 */
export function redactText(text: string, surface: Surface, options: RedactOptions = {}): RedactResult {
  let result = text;
  const applied: string[] = [];
  const replace = (needle: string, tag: string): boolean => {
    if (!needle) return false;
    const expression = new RegExp(escapeRegExp(needle), "g");
    if (!expression.test(result)) return false;
    result = result.replace(expression, `[REDACTED:${tag}]`);
    return true;
  };

  if (options.registry) {
    for (const { tag, needle } of options.registry.replacementMap()) {
      const shortTag = tag.replace(/^session:/, "").replace(/_encoded$/, "");
      if (replace(needle, shortTag)) applied.push(tag);
    }
  }
  for (const pattern of patternsFor(surface)) {
    // Редактируются только данные: персональные и секретные классы.
    // Инъекции обрабатываются блокировкой, маркеры - предупреждением.
    if (!pattern.id.startsWith("pii.") && !pattern.id.startsWith("secret.")) continue;
    const expression = new RegExp(pattern.regex.source, pattern.regex.flags);
    if (!expression.test(result)) continue;
    if (pattern.validate) {
      // С валидатором замена выполняется по одному совпадению.
      const verify = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = verify.exec(result)) !== null) {
        if (match[0].length === 0) {
          verify.lastIndex++;
          continue;
        }
        if (pattern.validate(match[0])) {
          result = result.replace(match[0], `[REDACTED:${pattern.label}]`);
          if (!applied.includes(`pattern:${pattern.id}`)) applied.push(`pattern:${pattern.id}`);
          verify.lastIndex = 0;
          continue;
        }
        if (verify.lastIndex === match.index) verify.lastIndex++;
      }
      continue;
    }
    result = result.replace(new RegExp(pattern.regex.source, pattern.regex.flags), `[REDACTED:${pattern.label}]`);
    applied.push(`pattern:${pattern.id}`);
  }
  return { text: result, applied };
}
