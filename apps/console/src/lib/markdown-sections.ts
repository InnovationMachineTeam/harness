/**
 * Разбор markdown-документа на секции по заголовкам H2 ("## ...") - основа
 * секционных редакторов (гайд DESIGN.md, BRAND.md): документ делится на
 * преамбулу и редактируемые карточки, структура заголовков остаётся на
 * стороне библиотеки. Заголовки внутри fenced-блоков секциями не считаются.
 * Каждый блок хранит свой текст дословно; склейка конкатенирует блоки и
 * воспроизводит исходный документ посимвольно.
 */

export interface MarkdownSection {
  /** Текст после "## " (метка карточки в интерфейсе). */
  title: string;
  /** Строка заголовка целиком, включая "## ". */
  heading: string;
  /** Текст блока, начиная со строки заголовка и до следующего H2 (дословно). */
  text: string;
}

export interface MarkdownSections {
  /** Текст до первого H2 (вступление, H1 и первые абзацы). */
  preamble: string;
  sections: MarkdownSection[];
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const H2_RE = /^##($|\s)/;

/** Разделить документ на преамбулу и секции H2. */
export function splitMarkdownSections(content: string): MarkdownSections {
  const preambleLines: string[] = [];
  const raw: { title: string; heading: string; lines: string[] }[] = [];
  let fenceChar: string | null = null;
  let current: { title: string; heading: string; lines: string[] } | null = null;

  for (const line of content.split("\n")) {
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const char = fenceMatch[1]![0]!;
      if (!fenceChar) fenceChar = char;
      else if (char === fenceChar) fenceChar = null;
    }
    if (!fenceChar && H2_RE.test(line)) {
      current = { title: line.replace(/^##\s*/, "").trim(), heading: line, lines: [line] };
      raw.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preambleLines.push(line);
  }

  return {
    preamble: preambleLines.join("\n"),
    sections: raw.map(({ title, heading, lines }) => ({ title, heading, text: lines.join("\n") })),
  };
}

/** Склейка из splitMarkdownSections воспроизводит исходный документ посимвольно. */
export function joinMarkdownSections(parts: MarkdownSections): string {
  if (parts.sections.length === 0) return parts.preamble;
  const head = parts.preamble === "" ? "" : `${parts.preamble}\n`;
  return head + parts.sections.map((section) => section.text).join("\n");
}

/** Тело секции для карточки редактора: текст после строки заголовка. */
export function markdownSectionBody(section: MarkdownSection): string {
  const rest = section.text.slice(section.heading.length);
  return rest.startsWith("\n") ? rest.slice(1) : rest;
}

/** Собрать блок секции из заголовка и отредактированного тела. */
export function composeMarkdownSection(section: MarkdownSection, body: string): MarkdownSection {
  return { ...section, text: body === "" ? section.heading : `${section.heading}\n${body}` };
}
