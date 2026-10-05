import { describe, expect, test } from "bun:test";
import { GuardBlockedError, classifierGate } from "../src/llm/classifierGate";
import { classifierFromEnv, classifierFromOllama } from "../src/llm/classifier";

test("без конфигурации классификатор отсутствует", () =>
  expect(classifierFromEnv({})).toBeNull());

test("классификатор разбирает вердиктModeration-эндпоинта", async () => {
  const classifier = classifierFromEnv({ GUARDRAILS_CLASSIFIER_URL: "https://moderation.test/v1/moderations" }, async () =>
    new Response(JSON.stringify({ results: [{ flagged: true, categories: { violence: true } }] }), { status: 200 }));
  const verdict = await classifier.flag("текст");
  expect(verdict).toEqual({ flagged: true, label: "violence" });
});

test("ollama-протокол: JSON-вердикт из /api/chat разбирается", async () => {
  const classifier = classifierFromOllama("http://localhost:11434", "test-model", async (input, init) => {
    expect(String(input)).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ role: string }> };
    expect(body.model).toBe("test-model");
    expect(body.messages.some((message) => message.role === "system")).toBe(true);
    return new Response(JSON.stringify({ message: { content: 'Вердикт: {"flagged": true, "label": "injection"}' } }), { status: 200 });
  });
  await expect(classifier.flag("текст")).resolves.toEqual({ flagged: true, label: "injection" });
});

test("ollama-протокол: чистый вердикт и сбой дают корректный результат", async () => {
  const clean = classifierFromOllama("http://localhost:11434", "m", async () =>
    new Response(JSON.stringify({ message: { content: '{"flagged": false}' } }), { status: 200 }));
  await expect(clean.flag("текст")).resolves.toEqual({ flagged: false, label: undefined });
  const broken = classifierFromOllama("http://localhost:11434", "m", async () => {
    throw new Error("network");
  });
  await expect(broken.flag("текст")).resolves.toBeNull();
});

test("env с /api/chat выбирает ollama-протокол", () => {
  const classifier = classifierFromEnv({ GUARDRAILS_CLASSIFIER_URL: "http://localhost:11434/api/chat", GUARDRAILS_CLASSIFIER_MODEL: "m1" });
  expect(classifier).not.toBeNull();
});

test("сбой классификатора даёт null, а не ошибку", async () => {
  const classifier = classifierFromEnv({ GUARDRAILS_CLASSIFIER_URL: "https://moderation.test" }, async () => {
    throw new Error("network");
  });
  await expect(classifier.flag("текст")).resolves.toBeNull();
});

describe("classifierGate", () => {
  test("без классификатора пропускает", async () => {
    await expect(classifierGate(null, "текст")).resolves.toBeUndefined();
  });
  test("flagged-вердикт бросает GuardBlockedError", async () => {
    const classifier = { flag: async () => ({ flagged: true, label: "violence" }) };
    await expect(classifierGate(classifier, "текст")).rejects.toBeInstanceOf(GuardBlockedError);
  });
  test("чистый вердикт пропускает", async () => {
    const classifier = { flag: async () => ({ flagged: false }) };
    await expect(classifierGate(classifier, "текст")).resolves.toBeUndefined();
  });
});
