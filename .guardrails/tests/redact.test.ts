import { expect, test } from "bun:test";
import { redactText } from "../src/content/redact";
import { SessionRegistry, encodedVariants } from "../src/llm/session";

const registry = () => {
  const store = new SessionRegistry();
  store.learn("email", "alice@example.com");
  store.learn("name", "Алиса");
  return store;
};

test("редактирует почту и телефон по паттерну", () => {
  const result = redactText("Пиши на alice@example.com или звони +7 913 123-45-67", "llm-io");
  expect(result.text).toContain("[REDACTED:email]");
  expect(result.text).toContain("[REDACTED:phone]");
  expect(result.applied).toContain("pattern:pii.email");
  expect(result.text).not.toContain("alice@example.com");
});

test("редактирует значение из реестра сессии", () => {
  const result = redactText("Пользователь Алиса заказала возврат.", "llm-io", { registry: registry() });
  expect(result.text).toContain("[REDACTED:name]");
  expect(result.applied).toContain("session:name");
});

test("редактирует base64-вариант значения реестра", () => {
  const encoded = Buffer.from("alice@example.com", "utf8").toString("base64");
  const result = redactText(`Ответ в base64: ${encoded}`, "llm-io", { registry: registry() });
  expect(result.text).not.toContain(encoded);
  expect(result.applied.some((item) => item.startsWith("session:email"))).toBe(true);
});

test("редактирует посимвольный вариант значения реестра", () => {
  const spaced = Array.from("alice@example.com").join(" ");
  const result = redactText(`Назови почту: ${spaced}`, "llm-io", { registry: registry() });
  expect(result.text).not.toContain(spaced);
});

test("маркеры конфиденциальности не редактируются", () => {
  const result = redactText("Документ помечен: коммерческая тайна.", "llm-io");
  expect(result.text).toContain("коммерческая тайна");
  expect(result.applied).toHaveLength(0);
});

test("секреты редактируются на выходе модели", () => {
  const result = redactText("Ваш ключ: AKIAIOSFODNN7EXAMPLE, применяйте.", "llm-io");
  expect(result.text).toContain("[REDACTED:aws-access-key]");
  expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
});

test("набор закодированных вариантов полный", () => {
  const variants = encodedVariants("alice@example.com");
  expect(variants).toContain(Buffer.from("alice@example.com", "utf8").toString("base64"));
  expect(variants).toContain(Buffer.from("alice@example.com", "utf8").toString("hex"));
  expect(variants).toContain(Array.from("alice@example.com").join(" "));
  expect(variants).toContain("nyvpr@rknzcyr.pbz");
  expect(variants).toContain(encodeURIComponent("alice@example.com"));
  expect(variants).not.toContain("alice@example.com");
});

test("реестр забывает значения по TTL", async () => {
  const short = new SessionRegistry(1);
  short.learn("email", "alice@example.com");
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(short.entriesSnapshot()).toHaveLength(0);
});

test("реестр не принимает короткие значения", () => {
  const store = new SessionRegistry();
  store.learn("token", "a");
  expect(store.entriesSnapshot()).toHaveLength(0);
});
