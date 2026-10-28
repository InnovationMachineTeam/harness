/**
 * Описание инструмента MCP-сервера harness как данные: набор инструментов
 * собирается функцией (конфиг + каталоги рабочих папок) и применяется к
 * McpServer целиком - это позволяет пересобирать набор без пересоздания
 * соединения (register/enable/disable + уведомление toolListChanged).
 *
 * Аргументы обработчика типизируются схемой только на рантайме (zod-парсинг
 * SDK): статический тип - any, конкретную сигнатуру задаёт действие в actions.
 */
export interface ToolSpec<S extends import("zod").ZodRawShape = import("zod").ZodRawShape> {
  /** Короткое имя внутри сервера (полное имя у клиента: mcp__harness__<name>). */
  name: string;
  description: string;
  /** Zod-схема параметров (raw shape для registerTool). */
  schema: S;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<unknown>;
}

/** Потолок текста результата инструмента; избыток отсекается с маркером. */
export const TOOL_OUTPUT_LIMIT = 48_000;

/** Результат инструмента как текст: JSON с отсечением по объёму. */
export function stringifyToolResult(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    text = String(value);
  }
  if (text.length <= TOOL_OUTPUT_LIMIT) return text;
  return text.slice(0, TOOL_OUTPUT_LIMIT) + `\n(отсечено: ${text.length - TOOL_OUTPUT_LIMIT} символов сверх лимита ${TOOL_OUTPUT_LIMIT})`;
}
