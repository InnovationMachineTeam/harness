import { describe, expect, test } from "bun:test";
import { composeMarkdownSection, joinMarkdownSections, markdownSectionBody, splitMarkdownSections } from "@/lib/markdown-sections";

describe("markdown-sections", () => {
  test("документ делится на преамбулу и секции H2", () => {
    const doc = "# Заголовок\n\nВступление.\n\n## Первая\n\nТекст первой.\n\n## Вторая\n- пункт\n";
    const parts = splitMarkdownSections(doc);
    expect(parts.preamble).toBe("# Заголовок\n\nВступление.\n");
    expect(parts.sections.map((s) => s.title)).toEqual(["Первая", "Вторая"]);
    expect(parts.sections[0]!.heading).toBe("## Первая");
    expect(markdownSectionBody(parts.sections[0]!)).toBe("\nТекст первой.\n");
    expect(markdownSectionBody(parts.sections[1]!)).toBe("- пункт\n");
  });

  test("склейка воспроизводит документ посимвольно (с переносом и без)", () => {
    const docs = [
      "# A\n\nвступление\n\n## S1\n\nтело 1\n\n## S2\nтело 2\n",
      "# A\n\nвступление\n\n## S1\n\nтело 1\n\n## S2\nтело 2",
      "## A\nx\n## B\ny",
      "просто текст\n\nи ещё\n",
      "просто текст без переносов",
      "",
    ];
    for (const doc of docs) {
      expect(joinMarkdownSections(splitMarkdownSections(doc))).toBe(doc);
    }
  });

  test("заголовки внутри fenced-блоков секциями не считаются", () => {
    const doc = "## Настоящая\n\n```md\n## Не секция\n~~~\n## Тоже нет\n```\n\nхвост\n";
    const parts = splitMarkdownSections(doc);
    expect(parts.sections.map((s) => s.title)).toEqual(["Настоящая"]);
    expect(markdownSectionBody(parts.sections[0]!)).toContain("## Не секция");
    expect(joinMarkdownSections(parts)).toBe(doc);
  });

  test("заголовки H1/H3 и '#'-строки без пробела не делят документ", () => {
    const doc = "# H1\n### H3\n##S без пробела\n\n## Секция\nтело\n";
    const parts = splitMarkdownSections(doc);
    expect(parts.preamble).toBe("# H1\n### H3\n##S без пробела\n");
    expect(parts.sections).toHaveLength(1);
  });

  test("правка тела одной секции не меняет остальные блоки", () => {
    const doc = "## A\n\nстарое\n\n## B\n\nтело B\n";
    const parts = splitMarkdownSections(doc);
    parts.sections[0] = composeMarkdownSection(parts.sections[0]!, markdownSectionBody(parts.sections[0]!).replace("старое", "новое"));
    const next = joinMarkdownSections(parts);
    expect(next).toBe("## A\n\nновое\n\n## B\n\nтело B\n");
    expect(markdownSectionBody(splitMarkdownSections(next).sections[1]!)).toBe("\nтело B\n");
  });

  test("тело последней секции без завершающего переноса сохраняется", () => {
    const doc = "## A\n\nтело A\n\n## B\nтело B";
    const parts = splitMarkdownSections(doc);
    expect(markdownSectionBody(parts.sections[1]!)).toBe("тело B");
    expect(joinMarkdownSections(parts)).toBe(doc);
  });
});
