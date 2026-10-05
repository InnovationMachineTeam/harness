// Фильтр само-сканирования: артефакты Guardrails легитимно содержат
// образцы паттернов (карточки правил, fixtures корпуса, каталог).
// Вывод инструментов, обращённых к ним, не сканируется, чтобы guard
// не срабатывал на собственную документацию.

export const SELF_ARTIFACTS = /guardrails\/(rules|generated|tests)(\/|$)|guardrails\/src\/content(\/|$)|guardrails\/src\/posttooluse\.ts/;

/** Предельный размер вывода для скана, байт. */
export const SCAN_LIMIT_BYTES = 262144;

const SCAN_INPUT_FIELDS = [
  "file_path", "filePath", "path", "notebook_path", "command", "cmd",
  "pattern", "query", "url", "skill", "command_prefix",
];

/**
 * Возвращает описание причины пропуска скана, если вызов инструмента
 * обращён к артефактам Guardrails, иначе null.
 */
export function toolScanSkip(toolName: unknown, toolInput: unknown): string | null {
  const source = toolInput && typeof toolInput === "object" ? toolInput as Record<string, unknown> : {};
  for (const field of SCAN_INPUT_FIELDS) {
    const value = source[field];
    if (typeof value === "string" && SELF_ARTIFACTS.test(value)) {
      return `${field}: ${value.slice(0, 80)}`;
    }
  }
  return null;
}
