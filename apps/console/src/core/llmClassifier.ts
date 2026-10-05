import { classifierFromEnv, classifierFromOllama, type ContentClassifier } from "@harness/guardrails";

/**
 * Классификатор direct-чата: второй слой на входе. Решение по умолчанию -
 * локальный ollama (без внешней эгрессии), быстрая модель, таймаут 5 с,
 * сбой классификатора пропускает текст (паттерновый слой остаётся
 * основным). Переменные GUARDRAILS_CLASSIFIER_URL / GUARDRAILS_CLASSIFIER_MODEL
 * переопределяют настройки; GUARDRAILS_CLASSIFIER_DISABLED=1 выключает слой.
 */

let cached: ContentClassifier | null | undefined;

export function getChatClassifier(): ContentClassifier | null {
  if (cached !== undefined) return cached;
  if (process.env.GUARDRAILS_CLASSIFIER_DISABLED === "1") {
    cached = null;
    return cached;
  }
  cached = classifierFromEnv() ?? classifierFromOllama(
    process.env.GUARDRAILS_CLASSIFIER_BASE_URL?.trim() || "http://localhost:11434",
    process.env.GUARDRAILS_CLASSIFIER_MODEL?.trim() || "deepseek-v4.1-flash:cloud",
  );
  return cached;
}

/** Сброс синглтона; для тестов. */
export function resetChatClassifier(): void {
  cached = undefined;
}
