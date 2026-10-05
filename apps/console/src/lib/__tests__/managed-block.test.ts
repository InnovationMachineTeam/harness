import { describe, expect, test } from "bun:test";
import { hasManagedBlock, managedMarkers, removeManagedBlock, upsertManagedBlock } from "@/lib/managed-block";

describe("managed-блоки", () => {
  test("маркеры блока по имени", () => {
    expect(managedMarkers("harness-design")).toEqual({
      start: "<!-- harness-design:start -->",
      end: "<!-- harness-design:end -->",
    });
  });

  test("upsert дописывает блок в конец файла и не дублируется при повторной записи", () => {
    const first = upsertManagedBlock("# Заголовок\n", "x", "содержимое v1");
    expect(first).toContain("<!-- x:start -->\nсодержимое v1\n<!-- x:end -->");
    const second = upsertManagedBlock(first, "x", "содержимое v2");
    expect((second.match(/x:start/g) ?? []).length).toBe(1);
    expect(second).toContain("содержимое v2");
    expect(second).not.toContain("содержимое v1");
    expect(second).toContain("# Заголовок");
  });

  test("upsert в пустой файл и в файл без завершающего переноса", () => {
    expect(upsertManagedBlock("", "x", "a")).toBe("<!-- x:start -->\na\n<!-- x:end -->\n");
    const noTrailing = upsertManagedBlock("текст", "x", "a");
    expect(noTrailing.startsWith("текст\n\n<!-- x:start -->")).toBe(true);
  });

  test("содержимое с $ не ломает замену", () => {
    const text = upsertManagedBlock("base", "x", "цена $100 и $& $1");
    const again = upsertManagedBlock(text, "x", "второй $1 pass");
    expect(again).toContain("второй $1 pass");
    expect(again).not.toContain("цена $100");
  });

  test("hasManagedBlock и removeManagedBlock", () => {
    const text = upsertManagedBlock("# Файл\n", "x", "блок");
    expect(hasManagedBlock(text, "x")).toBe(true);
    expect(hasManagedBlock("# Файл\n", "x")).toBe(false);
    const cleaned = removeManagedBlock(text, "x");
    expect(cleaned).toBe("# Файл\n");
    expect(hasManagedBlock(cleaned, "x")).toBe(false);
  });

  test("removeManagedBlock не меняет текст без блока", () => {
    expect(removeManagedBlock("обычный текст", "x")).toBe("обычный текст");
  });
});
