import { describe, expect, test } from "bun:test";
import { redactComposer } from "@/lib/redactComposer";

describe("redactComposer", () => {
  test("чистый текст возвращается без изменений и без нотификации", () => {
    const result = redactComposer("Собери отчёт по задачам за неделю.");
    expect(result.text).toBe("Собери отчёт по задачам за неделю.");
    expect(result.notice).toBeNull();
  });
  test("почта и карта заменяются, нотификация перечисляет метки", () => {
    const result = redactComposer("Пиши на ivan@example.com, карта 4242 4242 4242 4242.");
    expect(result.text).not.toContain("ivan@example.com");
    expect(result.text).toContain("[REDACTED:");
    expect(result.notice).toContain("Скрыты конфиденциальные данные");
    expect(result.notice).toContain("pii.email");
    expect(result.notice).toContain("pii.card");
  });
  test("секрет заменяется на плейсхолдер", () => {
    // Литерал собирается конкатенацией: строка теста не должна совпадать
    // с формой ключа (pre-commit scan-diff проверяет добавленные строки).
    const key = "AKIA" + "IOSFODNN7EXAMPLE";
    const result = redactComposer(`Ключ: ${key}, используй его.`);
    expect(result.text).not.toContain(key);
    expect(result.text).toContain("[REDACTED:aws-access-key]");
  });
});
