import type { UIChunk } from "@/core/agent/chatStream";

/**
 * Адаптер протокола AG-UI 1.0 (HTTP SSE binding): преобразует части стрима
 * direct-чата (UIChunk из core/agent/chatStream.ts) в события AG-UI для
 * внешних клиентов (CopilotKit OpenBot/OpenDuet/OpenMuse подключают Harness
 * как агента по bring-your-own-agent). Кадр SSE - строка "data: <json>\n\n"
 * (data-only, LF); один кадр - ровно один объект события. Терминальные
 * события обязательны: RUN_FINISHED или RUN_ERROR.
 *
 * Ограничения v1: аргументы вызовов инструментов передаются целиком (стриминга
 * аргументов нет - chatStream отдаёт input только полным), клиентские
 * (frontend) инструменты не поддерживаются - цикл инструментов идёт на сервере;
 * data-spec части json-render не транслируются.
 */

export type AguiEvent = Record<string, unknown>;

export interface AguiRunContext {
  threadId: string;
  runId: string;
}

/** Кадр SSE для события протокола. */
export function aguiFrame(event: AguiEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

/** Стрим UIChunk -> события AG-UI: текст триадой Start/Content/End, инструменты Start/Args/End/Result. */
export async function* uiChunksToAguiEvents(chunks: AsyncIterable<UIChunk>, ctx: AguiRunContext): AsyncGenerator<AguiEvent> {
  yield { type: "RUN_STARTED", threadId: ctx.threadId, runId: ctx.runId };
  let runError: string | null = null;
  for await (const chunk of chunks) {
    const item = chunk as Record<string, unknown>;
    switch (item.type) {
      case "start":
      case "finish":
        break;
      case "text-start":
        yield { type: "TEXT_MESSAGE_START", messageId: `msg-${item.id}`, role: "assistant" };
        break;
      case "text-delta":
        yield { type: "TEXT_MESSAGE_CONTENT", messageId: `msg-${item.id}`, delta: String(item.delta ?? "") };
        break;
      case "text-end":
        yield { type: "TEXT_MESSAGE_END", messageId: `msg-${item.id}` };
        break;
      case "tool-input-available": {
        const callId = String(item.toolCallId ?? "");
        yield { type: "TOOL_CALL_START", toolCallId: callId, toolCallName: String(item.toolName ?? "") };
        yield { type: "TOOL_CALL_ARGS", toolCallId: callId, delta: JSON.stringify(item.input ?? {}) };
        yield { type: "TOOL_CALL_END", toolCallId: callId };
        break;
      }
      case "tool-output-available":
        yield {
          type: "TOOL_CALL_RESULT",
          messageId: `result-${item.toolCallId}`,
          toolCallId: String(item.toolCallId ?? ""),
          content: textContent(item.output),
        };
        break;
      case "error":
        runError = String(item.errorText ?? "ошибка выполнения");
        break;
      default:
        break;
    }
  }
  if (runError) yield { type: "RUN_ERROR", message: runError };
  else yield { type: "RUN_FINISHED" };
}

/** Форма реплики UIMessage: текстовые части с обязательным полем type. */
export interface AguiUiMessage {
  role: string;
  parts: Array<{ type: string; text: string }>;
}

/** Сообщение AG-UI ({id, role, content}) -> реплика UIMessage-формата direct-чата. */
export function aguiMessageToUiMessage(message: { id?: unknown; role?: unknown; content?: unknown }): AguiUiMessage | null {
  const role = message.role === "assistant" || message.role === "system" ? String(message.role) : "user";
  const text = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((block) => (typeof block === "string" ? block : typeof (block as { text?: unknown })?.text === "string" ? (block as { text: string }).text : "")).join("")
      : "";
  if (!text.trim()) return null;
  return { role, parts: [{ type: "text", text }] };
}

/** threadId AG-UI -> id direct-чата: префикс direct-agui- и безопасный алфавит [0-9a-zA-Z-]. */
export function threadIdToChatId(threadId: string): string {
  const safe = threadId.replace(/[^0-9a-zA-Z-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return `direct-agui-${safe || "thread"}`;
}
