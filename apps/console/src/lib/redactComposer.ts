import { redactText } from "@harness/guardrails/redact";

/**
 * Редактирование пользовательского текста перед отправкой: персональные
 * данные и секреты заменяются плейсхолдерами, текст уходит в историю и
 * на исполнение уже отредактированным. notice - текст для нотификации
 * или null, если замен не было.
 */
export function redactComposer(text: string): { text: string; notice: string | null } {
  // Поверхность llm-io: персональные данные И секреты (в prompt-поверхности
  // секретных классов нет - их зона - уход в модель и в репозиторий).
  const result = redactText(text, "llm-io");
  if (!result.applied.length) return { text, notice: null };
  const labels = [...new Set(result.applied.map((item) => item.replace(/^(pattern|session):/, "").replace(/_encoded$/, "")))];
  return { text: result.text, notice: `Скрыты конфиденциальные данные (${result.applied.length}): ${labels.join(", ")}` };
}
