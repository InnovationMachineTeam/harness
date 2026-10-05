import { GuardBlockedError } from "./wrappers";
import type { ContentClassifier } from "./classifier";

export { GuardBlockedError };

/**
 * Асинхронная проверка текста модельным классификатором до вызова
 * модели. Дополняет синхронный паттерновый слой; без классификатора
 * (конфигурация по умолчанию) - no-op.
 */
export async function classifierGate(classifier: ContentClassifier | null, text: string): Promise<void> {
  if (!classifier) return;
  const verdict = await classifier.flag(text);
  if (verdict?.flagged) {
    throw new GuardBlockedError("prompt.classifier", `Модельный классификатор пометил текст (${verdict.label ?? "flagged"}).`);
  }
}
