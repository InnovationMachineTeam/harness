import { beforeAll, describe, expect, test } from "bun:test";
import attacks from "./fixtures/attacks.json";
import { redactText } from "../src/content/redact";
import { probeMatches } from "../src/content/probes";
import { scanText } from "../src/content/scan";
import { SessionRegistry } from "../src/llm/session";
import { GuardBlockedError, transformValue } from "../src/llm/wrappers";
import { createLlmGuard } from "../src/llm/guard";

interface Attack {
  id: string;
  class: string;
  surface: "prompt" | "tool-output" | "llm-io";
  expect: "block" | "probe" | "redact" | "miss";
  text: string;
}

const corpus = attacks as { version: number; attacks: Attack[] };
const EMAIL = "ivan.petrov@example.com";

let registry: SessionRegistry;
let guard: ReturnType<typeof createLlmGuard>;

beforeAll(() => {
  registry = new SessionRegistry();
  registry.learn("email", EMAIL);
  guard = createLlmGuard({ registry });
});

/** Подставляет закодированные варианты значений реестра в текст атаки. */
function expand(text: string): string {
  const variants = new Map([
    ["{{base64:email}}", Buffer.from(EMAIL, "utf8").toString("base64")],
    ["{{spaced:email}}", Array.from(EMAIL).join(" ")],
  ]);
  let result = text;
  for (const [placeholder, value] of variants) result = result.replace(placeholder, value);
  return result;
}

describe("корпус атак", () => {
  for (const attack of corpus.attacks) {
    test(`${attack.id} (${attack.class}, ${attack.expect})`, () => {
      const text = expand(attack.text);
      if (attack.expect === "block") {
        const findings = scanText(text, attack.surface).filter((finding) => finding.patternId.startsWith("inj."));
        expect(findings.length).toBeGreaterThan(0);
      } else if (attack.expect === "probe") {
        expect(probeMatches(text)).not.toBeNull();
      } else if (attack.expect === "redact") {
        const result = redactText(text, attack.surface, { registry });
        expect(result.applied.length).toBeGreaterThan(0);
        expect(result.text).not.toContain(EMAIL);
      } else {
        const findings = scanText(text, attack.surface).filter((finding) => finding.patternId.startsWith("inj."));
        expect(findings).toHaveLength(0);
      }
    });
  }

  test("блокирующих и зондовых кейсов достаточно для регрессии", () => {
    const blocking = corpus.attacks.filter((attack) => attack.expect === "block" || attack.expect === "probe" || attack.expect === "redact");
    expect(blocking.length).toBeGreaterThanOrEqual(20);
  });

  test("miss-кейсы задокументированы как остаточный риск", () => {
    const misses = corpus.attacks.filter((attack) => attack.expect === "miss");
    expect(misses.length).toBeGreaterThanOrEqual(2);
  });

  test("аргумент вызова инструмента с инъекцией блокируется обёрткой", () => {
    const argument = corpus.attacks.find((attack) => attack.id === "ua-001")!;
    expect(() => transformValue({ user_id: argument.text }, guard, true)).toThrow(GuardBlockedError);
  });

  test("безопасный аргумент вызова инструмента проходит", () => {
    const argument = corpus.attacks.find((attack) => attack.id === "ua-002")!;
    const transformed = transformValue({ query: argument.text }, guard, true) as { query: string };
    expect(transformed.query).toBe(argument.text);
  });
});
