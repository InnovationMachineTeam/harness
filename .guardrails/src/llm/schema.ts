// Принудительная схема структурированного вывода. Ответ модели всегда
// возвращается в форме JSON: вредоносное содержимое отклоняется, вне-
// схемные ответы оборачиваются, типы приводятся. Реализация собственная
// по классам угроз threat-model внешнего репозитория (см. SOURCES.md).

export interface OutputSchema {
  required: string[];
  types?: Record<string, "string" | "number" | "boolean" | "object" | "array">;
}

export interface CoerceResult {
  text: string;
  valid: boolean;
  reasons: string[];
}

/** Паттерны вредоносного содержимого в ответе. */
export const HARMFUL_OUTPUT_PATTERNS: RegExp[] = [
  /\b(?:sure|absolutely|of course)[^.\n]{0,40}here(?:'s| is)\s+how\b/i,
  /\bhack(?:ing)?\s+(?:the|a|into|this)\b/i,
  /\b(?:exploit|shellcode|reverse\s+shell)\b/i,
  /\b(?:dan\s+mode|developer\s+mode|jailbreak(?:ed)?)\b/i,
];

const STEP_PATTERN = /(?<![\p{L}])step\s*\d+\s*[:.)]/giu;

/** Ответ без видимых символов (управляющие, невидимые, пробелы) не передаётся дальше. */
export function hasVisibleCharacters(text: string): boolean {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(text);
}

export function isHarmful(text: string): boolean {
  if (HARMFUL_OUTPUT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const steps = text.match(new RegExp(STEP_PATTERN.source, "gi"));
  return (steps?.length ?? 0) >= 2;
}

const TYPE_GUARDS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  object: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  array: (value) => Array.isArray(value),
};

function safeRejection(reason: string): CoerceResult {
  return {
    text: JSON.stringify({ error: reason, message: "I'm not able to help with that request." }),
    valid: false,
    reasons: [reason],
  };
}

/**
 * Возвращает ответ, всегда пригодный для JSON-парсера вызывающей
 * стороны: valid=true означает нетронутый ответ, иначе - причины правок.
 */
export function coerceStructuredOutput(raw: string, schema: OutputSchema): CoerceResult {
  const required = schema.required.length ? schema.required : ["answer"];
  if (isHarmful(raw)) return safeRejection("rejected_harmful_content");
  if (!hasVisibleCharacters(raw)) return safeRejection("rejected_no_visible_characters");

  const reasons: string[] = [];
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    else if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
      data = parsed[0] as Record<string, unknown>;
      reasons.push("coerced_array_first_element");
    }
  } catch {
    // Вне-схемный ответ оборачивается в обязательное поле.
  }
  if (!data) {
    const answer = raw.trim();
    data = { [required[0]]: answer || "Пустой ответ модели." };
    reasons.push("wrapped_not_json");
  }

  const primary = required[0];
  const primaryValue = data[primary];
  // Вредоносное содержимое внутри JSON уже отклонено сырой проверкой:
  // строка ответа содержит тот же текст.
  if (primaryValue === undefined || primaryValue === null) {
    return {
      text: JSON.stringify({ error: "wrapped_missing_answer", message: "Ответ модели не содержит обязательного поля." }),
      valid: false,
      reasons: [`wrapped_missing_${primary}`],
    };
  }

  for (const field of required) {
    if (field === primary) continue;
    if (data[field] === undefined || data[field] === null) {
      data[field] = null;
      reasons.push(`coerced_missing_${field}`);
    }
  }
  for (const [field, expected] of Object.entries(schema.types ?? {})) {
    if (data[field] === undefined || data[field] === null) continue;
    if (!TYPE_GUARDS[expected](data[field])) {
      data[field] = null;
      reasons.push(`coerced_type_${field}:${expected}`);
    }
  }

  if (reasons.length === 0) return { text: raw, valid: true, reasons };
  return { text: JSON.stringify(data), valid: false, reasons };
}
