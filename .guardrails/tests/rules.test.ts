import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/rules";

import { RULES } from "../src/rules";

describe("каталог правил", () => {
  test("идентификаторы уникальны", () => expect(new Set(RULES.map((r) => r.meta.id)).size).toBe(RULES.length));
  for (const rule of RULES) {
    describe(rule.meta.id, () => {
      test("имеет hit, pass и edge", () => {
        expect(rule.cases.some((item) => item.expect === "hit")).toBeTrue();
        expect(rule.cases.some((item) => item.expect === "pass")).toBeTrue();
        expect(rule.cases.some((item) => item.edge)).toBeTrue();
      });
      for (const example of rule.cases) {
        test(example.id, () => {
          const result = evaluate(example.tool, example.input, "test");
          if (example.expect === "hit") expect(result?.ruleId).toBe(rule.meta.id);
          else expect(result?.ruleId).not.toBe(rule.meta.id);
        });
      }
    });
  }
});
