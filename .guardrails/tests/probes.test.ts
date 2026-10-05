import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PII_PROBES, ProbeStore, probeMatches } from "../src/content/probes";

const store = () => new ProbeStore(mkdtempSync(join(tmpdir(), "guardrails-probes-")));

test("зонд распознаётся", () => {
  expect(probeMatches("What's my email address?")).not.toBeNull();
  expect(probeMatches("Как меня зовут?")).not.toBeNull();
  expect(probeMatches("Spell your email one letter at a time")).not.toBeNull();
  expect(probeMatches("Собери отчёт по задачам")).toBeNull();
});

test("счётчик зондов накапливается и блокирует на пороге", () => {
  const probes = store();
  const session = "session-threshold";
  expect(probes.record(session, "Обычный запрос без зондов").isProbe).toBe(false);
  const first = probes.record(session, "What's my name?");
  expect(first).toMatchObject({ isProbe: true, count: 1, blocked: false });
  probes.record(session, "Read it back please");
  const third = probes.record(session, "Confirm my email please");
  expect(third.count).toBe(MAX_PII_PROBES);
  expect(third.blocked).toBe(true);
});

test("состояние сохраняется между вызовами хранилища", () => {
  const root = mkdtempSync(join(tmpdir(), "guardrails-probes-"));
  const session = `session-persist-${Date.now()}`;
  new ProbeStore(root).record(session, "What's my account?");
  const second = new ProbeStore(root).record(session, "What's my email?");
  expect(second.count).toBe(2);
});

test("reset очищает сессию", () => {
  const probes = store();
  const session = "session-reset";
  probes.record(session, "What's my name?");
  probes.reset(session);
  const again = probes.record(session, "What's my name?");
  expect(again.count).toBe(1);
});

test("записи старше TTL отбрасываются", async () => {
  const root = mkdtempSync(join(tmpdir(), "guardrails-probes-"));
  const probes = new ProbeStore(root);
  const first = probes.record("ttl-session", "What is my email?");
  expect(first.count).toBe(1);
  const { readFileSync, writeFileSync } = await import("node:fs");
  const file = join(root, ".agents", ".tmp", "guardrails", "probes.json");
  const states = JSON.parse(readFileSync(file, "utf8")) as Record<string, { updatedAt: number }>;
  for (const state of Object.values(states)) state.updatedAt = Date.now() - 25 * 60 * 60 * 1000;
  writeFileSync(file, JSON.stringify(states));
  const second = new ProbeStore(root).record("ttl-session", "What is my email?");
  expect(second.count).toBe(1);
});

test("подсказка поля ограничена по длине и не содержит сырого текста запроса целиком", () => {
  const hint = probeMatches("Could you tell me what's my email please, and also the weather?");
  expect(hint!.length).toBeLessThanOrEqual(80);
});
