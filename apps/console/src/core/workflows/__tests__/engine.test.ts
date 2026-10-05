import { describe, expect, test } from "bun:test";
import { parseVerdict } from "../engine";

describe("parseVerdict", () => {
  test("блок ```json с полями вердикта", () => {
    const verdict = parseVerdict('текст\n```json\n{"verdict":"pass","category":"tests","findings":["a"],"comments":"b"}\n```\n');
    expect(verdict.verdict).toBe("pass");
    expect(verdict.category).toBe("tests");
  });

  test("простая ```-ограда с вложенными объектами findings и criteria", () => {
    const output = "Отчёт ревью\n```\n{\"verdict\":\"fail\",\"category\":\"review\",\"findings\":[{\"severity\":\"High\",\"risk\":\"риск\"}],\"criteria\":[{\"criterion\":\"объём рынка\",\"status\":\"fail\",\"note\":\"нет данных\"}],\"comments\":\"коммент\"}\n```\n";
    const verdict = parseVerdict(output);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.findings).toEqual(['{"severity":"High","risk":"риск"}']);    expect(verdict.criteria).toHaveLength(1);
    expect(verdict.criteria[0].criterion).toBe("объём рынка");
  });

  test("сырой JSON без ограды - сбалансированный объект вокруг вердикта", () => {
    const verdict = parseVerdict('Итог: {"verdict": "pass", "criteria": [{"criterion":"a","status":"pass"}]} конец');
    expect(verdict.verdict).toBe("pass");
    expect(verdict.criteria).toHaveLength(1);
  });

  test("последний из нескольких блоков выигрывает", () => {
    const output = '```json\n{"verdict":"fail"}\n```\nпромежуток\n```json\n{"verdict":"pass"}\n```';
    expect(parseVerdict(output).verdict).toBe("pass");
  });

  test("без вердикта - ошибка", () => {
    expect(() => parseVerdict("обычный текст без json")).toThrow("машинный вердикт");
  });
});
