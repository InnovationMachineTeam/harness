import { patternsFor, type ContentPattern, type Surface } from "./patterns";

// Сканер текста и вложенных структур. Находка описывает класс данных
// и число вхождений; сырые совпадения не возвращаются и не логируются.

export interface ScanFinding {
  patternId: string;
  label: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  surface: Surface;
  count: number;
  /** Путь к полю во вложенной структуре; для верхнего уровня пусто. */
  where: string;
}

const printable = (text: string): boolean => {
  if (!text) return false;
  const printableChars = text.split("").filter((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 65533);
  }).length;
  return printableChars / text.length > 0.9;
};

/**
 * Варианты декодирования обфускации: base64, hex, rot13. Декодирование
 * выполняется только для строк, похожих на соответствующую кодировку;
 * результат сканируется вместе с исходным текстом.
 */
export function decodeVariants(text: string): string[] {
  const variants: string[] = [];
  const compact = text.trim();
  const folded = compact.normalize("NFKC");
  if (folded !== compact) variants.push(folded);
  // base64 и hex могут быть встроены в текст: извлекаются длинные
  // непрерывные фрагменты соответствующего алфавита.
  const runs = compact.match(/[A-Za-z0-9+/=]{28,}/g) ?? [];
  for (const run of runs) {
    try {
      const decoded = Buffer.from(run.replace(/=+$/, ""), "base64").toString("utf8");
      if (printable(decoded)) variants.push(decoded);
    } catch {
      // Некорректная base64-последовательность пропускается.
    }
  }
  for (const run of (compact.match(/[0-9a-fA-F]{40,}/g) ?? [])) {
    try {
      const decoded = Buffer.from(run, "hex").toString("utf8");
      if (printable(decoded)) variants.push(decoded);
    } catch {
      // Некорректная hex-последовательность пропускается.
    }
  }
  const rot13 = compact.replace(/[A-Za-z]/g, (character) => {
    const base = character <= "Z" ? 65 : 97;
    return String.fromCharCode(((character.charCodeAt(0) - base + 13) % 26) + base);
  });
  if (rot13 !== compact) variants.push(rot13);
  return variants;
}

function singleScan(pattern: ContentPattern, text: string, surface: Surface, where: string): ScanFinding | null {
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    if (pattern.validate && !pattern.validate(match[0])) continue;
    count++;
    if (regex.lastIndex === match.index) regex.lastIndex++;
  }
  return count
    ? { patternId: pattern.id, label: pattern.label, title: pattern.title, severity: pattern.severity, surface, count, where }
    : null;
}

/** Скан одного текста по поверхности с учётом декодированных вариантов. */
export function scanText(text: string, surface: Surface): ScanFinding[] {
  const patterns = patternsFor(surface);
  const findings = new Map<string, ScanFinding>();
  const absorb = (source: string) => {
    for (const pattern of patterns) {
      const finding = singleScan(pattern, source, surface, "");
      if (finding) {
        const known = findings.get(finding.patternId);
        if (known) known.count += finding.count;
        else findings.set(finding.patternId, finding);
      }
    }
  };
  absorb(text);
  for (const variant of decodeVariants(text)) absorb(variant);
  return [...findings.values()].sort((a, b) => b.severity.localeCompare(a.severity) || a.patternId.localeCompare(b.patternId));
}

/** Рекурсивный скан структуры: строки и имена ключей объектов. */
export function scanDeep(value: unknown, surface: Surface, basePath = ""): ScanFinding[] {
  const findings = new Map<string, ScanFinding>();
  const add = (finding: ScanFinding) => {
    const known = findings.get(`${finding.patternId}@${finding.where}`);
    if (known) known.count += finding.count;
    else findings.set(`${finding.patternId}@${finding.where}`, finding);
  };
  const visit = (item: unknown, path: string) => {
    if (typeof item === "string") {
      for (const finding of scanText(item, surface)) add({ ...finding, where: path });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((element, index) => visit(element, `${path}[${index}]`));
      return;
    }
    if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        const keyFindings = scanText(key, surface);
        for (const finding of keyFindings) add({ ...finding, where: `${path}.${key}:key`, count: finding.count });
        visit(child, path ? `${path}.${key}` : key);
      }
    }
  };
  visit(value, basePath);
  return [...findings.values()];
}

/** Максимальная критичность находок: critical > high > medium > low. */
export function highestSeverity(findings: ScanFinding[]): "low" | "medium" | "high" | "critical" | null {
  const order = ["low", "medium", "high", "critical"];
  let highest: ScanFinding["severity"] | null = null;
  for (const finding of findings) {
    if (!highest || order.indexOf(finding.severity) > order.indexOf(highest)) highest = finding.severity;
  }
  return highest;
}

/**
 * Токены высокой энтропии - кандидаты в безымянные секреты. Только
 * смешанные алфавитно-цифровые последовательности от 24 символов с
 * энтропией не ниже 4.0 бит на символ. Для диффов и истории: находки
 * не блокируют и не редактируются, выводятся в сводке.
 */
export function highEntropyTokens(text: string, limit = 10): string[] {
  const tokens = text.match(/[A-Za-z0-9_-]{24,}/g) ?? [];
  const results: string[] = [];
  for (const token of tokens) {
    const hasUpper = /[A-Z]/.test(token);
    const hasLower = /[a-z]/.test(token);
    const hasDigit = /[0-9]/.test(token);
    if (!hasUpper || !hasLower || !hasDigit) continue;
    const freq = new Map<string, number>();
    for (const character of token) freq.set(character, (freq.get(character) ?? 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) {
      const probability = count / token.length;
      entropy -= probability * Math.log2(probability);
    }
    if (entropy >= 4.0) {
      results.push(token);
      if (results.length >= limit) break;
    }
  }
  return results;
}
