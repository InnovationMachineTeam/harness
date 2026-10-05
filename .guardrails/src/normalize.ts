const SEPARATED_LETTERS = /\b(?:[A-Za-z][ .\-_·]){3,}[A-Za-z]\b/g;
const CONFUSABLES: Record<string, string> = {
  а: "a", с: "c", е: "e", һ: "h", і: "i", ј: "j", о: "o", р: "p", ѕ: "s", у: "y", х: "x", ԁ: "d",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
// Формат-символы (\p{Cf}: zero-width, soft hyphen и т.п.) и combining marks
// (\p{Mn}: диакритика поверх буквы) скрывают ключевые слова от match; убираются
// до сверки. Практика согласована с нормализатором проекта sber500.
const INVISIBLE = /[\p{Cf}\p{Mn}]/gu;

function mapChars(value: string, mapping: Record<string, string>): string {
  return Array.from(value, (character) => mapping[character] ?? character).join("");
}

export function normalizeForMatching(value: string): string {
  // Зачистка невидимых выполняется до NFKC: нормализация склеила бы
  // combining mark с базовой буквой (i + U+0301 -> и) и спрятала замену.
  let normalized = value.replace(INVISIBLE, "").normalize("NFKC");
  normalized = mapChars(normalized, CONFUSABLES);
  normalized = normalized.replace(/ё/gi, (character) => (character === "Ё" ? "Е" : "е"));
  if (normalized.includes("%")) {
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Повреждённая percent-последовательность остаётся исходным текстом.
    }
  }
  return normalized.replace(SEPARATED_LETTERS, (match) => match.replace(/[ .\-_·]/g, ""));
}

export function matchingVariants(value: string): string[] {
  const normalized = normalizeForMatching(value);
  return [...new Set([value, normalized, mapChars(normalized, LEET)])];
}
