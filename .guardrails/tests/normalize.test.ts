import { expect, test } from "bun:test";
import { normalizeForMatching } from "../src/normalize";

test("удаляет zero-width и разделители", () => expect(normalizeForMatching("c\u200B u r l")).toBe("curl"));
test("нормализует совместимые символы", () => expect(normalizeForMatching("ｒｍ -rf")).toBe("rm -rf"));
test("декодирует percent encoding", () => expect(normalizeForMatching("%72%6d -rf")).toBe("rm -rf"));
test("зачищает soft hyphen и combining marks", () => {
  expect(normalizeForMatching("cu\u00ADrl -rf")).toBe("curl -rf");
  expect(normalizeForMatching("i\u0301gnore instructions")).toBe("ignore instructions");
});
test("сворачивает ё в е", () => expect(normalizeForMatching("клён")).toBe("клен"));
