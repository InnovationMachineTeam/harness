import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

/**
 * Преобразование стрима LangGraph-графа direct-чата в части UIMessage-стрима
 * тех же типов, что отдавал AI SDK (text-start/delta/end, tool-input-,
 * tool-output-available, start/finish). Протокол клиента (useChat) не меняется.
 */

export type UIChunk = Record<string, unknown>;

/** Накопленный расход модели за прогон графа. */
export interface ChatStreamUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : (block as { text?: string }).text ?? ""))
      .join("");
  }
  return "";
}

type GraphEvents = AsyncIterable<unknown>;

/** События графа: при нескольких streamMode - кортеж [mode, payload], при одном - payload. */
function eventPayload(item: unknown): { mode: string; payload: unknown } {
  if (Array.isArray(item) && typeof item[0] === "string") return { mode: item[0], payload: item[1] };
  return { mode: "single", payload: item };
}

/**
 * Провайдерная ветка: streamMode ["messages", "updates"]. Токены модели
 * (messages) становятся текстовым фрагментом; полные сообщения узлов
 * (updates) - частями инструментов и метаданными расхода.
 */
export async function* providerChatUIMessages(events: GraphEvents, usage: ChatStreamUsage): AsyncGenerator<UIChunk> {
  yield { type: "start" };
  let textId: string | null = null;
  let textIndex = 0;
  // текстовые дельты с прошлого обновления узла "model": 0 - модель не стримила
  let tokenDeltas = 0;
  for await (const item of events) {
    const { mode, payload } = eventPayload(item);
    if (mode === "messages" || (mode === "single" && isMessageChunk(payload))) {
      // в messages-режиме payload - кортеж [chunk, metadata]
      const chunk = (Array.isArray(payload) ? payload[0] : payload) as { content?: unknown } | undefined;
      const delta = chunkText(chunk?.content);
      if (delta) {
        if (textId === null) {
          textId = String(textIndex++);
          yield { type: "text-start", id: textId };
        }
        tokenDeltas += 1;
        yield { type: "text-delta", id: textId, delta };
      }
      continue;
    }
    if (mode !== "updates") continue;
    const update = payload as Record<string, { messages?: BaseMessage[] } | undefined>;
    for (const nodeOutput of Object.values(update ?? {})) {
      for (const message of nodeOutput?.messages ?? []) {
        if (message instanceof AIMessage) {
          // модель без потоковой выдачи: полный текст приходит только в updates
          const fullText = chunkText(message.content);
          if (fullText && tokenDeltas === 0) {
            if (textId === null) {
              textId = String(textIndex++);
              yield { type: "text-start", id: textId };
            }
            yield { type: "text-delta", id: textId, delta: fullText };
          }
          tokenDeltas = 0;
          if (textId !== null) {
            yield { type: "text-end", id: textId };
            textId = null;
          }
          const meta = message.usage_metadata;
          if (meta) {
            usage.inputTokens += meta.input_tokens ?? 0;
            usage.outputTokens += meta.output_tokens ?? 0;
            usage.totalTokens += meta.total_tokens ?? 0;
          }
          for (const [index, call] of (message.tool_calls ?? []).entries()) {
            yield {
              type: "tool-input-available",
              toolCallId: call.id ?? `call_${index}`,
              toolName: call.name,
              input: call.args ?? {},
              dynamic: true,
            };
          }
        } else if (message instanceof ToolMessage) {
          yield {
            type: "tool-output-available",
            toolCallId: message.tool_call_id,
            output: message.content,
            dynamic: true,
          };
        }
      }
    }
  }
  if (textId !== null) yield { type: "text-end", id: textId };
  yield { type: "finish", finishReason: "stop" };
}

function isMessageChunk(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "content" in payload;
}

/**
 * Фильтр служебного шума из лога headless-CLI: строки диагностики с таймштампами,
 * баннер и маркеры codex, эхо промта, блок расхода токенов. Ответ модели проходит.
 * Список пополняется по мере наблюдения шума конкретных CLI.
 */
export class RuntimeLogNoiseFilter {
  private carry = "";
  /** строка-счётчик сразу после "tokens used" тоже шум */
  private suppressCount = false;
  /** codex печатает финальный ответ повторно после блока расхода - остаток лога шум */
  private dropRest = false;

  /** Прогнать очередной прирост лога; вернуть только чистый текст (без шума). */
  push(delta: string): string {
    if (this.dropRest) return "";
    this.carry += delta;
    const parts = this.carry.split("\n");
    this.carry = parts.pop() ?? "";
    let out = "";
    for (const line of parts) {
      const text = this.process(line);
      if (text !== null) out += text + "\n";
    }
    return out;
  }

  /** Хвост без завершающего перевода строки в конце стрима. */
  flush(): string {
    const rest = this.carry;
    this.carry = "";
    if (this.dropRest) return "";
    const text = this.process(rest);
    return text === null ? "" : text;
  }

  /**
   * Обработать одну полную строку лога; вернуть текст для выдачи или null (шум).
   * JSONL-события codex (--json): текст ответа - только item.completed/agent_message,
   * остальные события (reasoning, command_execution, usage) - шум.
   */
  private process(raw: string): string | null {
    if (this.dropRest) return null;
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return this.keepPlain(line);
      }
      const event = parsed as { type?: unknown; item?: { type?: unknown; text?: unknown } };
      if (typeof event?.type !== "string") return this.keepPlain(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        const text = event.item.text;
        return typeof text === "string" && text.trim() ? text : null;
      }
      return null;
    }
    return this.keepPlain(line);
  }

  /** Человекочитаемая строка: правила шума. */
  private keepPlain(raw: string): string | null {
    if (this.dropRest) return null;
    const trimmed = raw.replace(/\r$/, "").trim();
    if (this.suppressCount) {
      this.suppressCount = false;
      // после "tokens used" идёт число - единственный случай числовой строки-шума
      if (/^[\d\s,]+$/.test(trimmed)) return null;
    }
    if (/^tokens used$/i.test(trimmed)) {
      this.suppressCount = true;
      this.dropRest = true;
      return null;
    }
    if (!trimmed) return raw;
    const noise: RegExp[] = [
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+(ERROR|WARN|INFO|DEBUG|TRACE)\b/, // журналы сервиса
      /^ERROR\s+\w+::/,                                                 // диагностика rust-модулей (rmcp/codex)
      /^Reading additional input from stdin/i,                          // codex: ожидание stdin
      /^OpenAI Codex v[\w.]+/i,                                         // codex: баннер
      /^(workdir|model|provider|approval|sandbox|session id|reasoning effort|reasoning summaries)\s*:/i, // поля баннера
      /^-{3,}$/,                                                        // разделители баннера
      /^(Пользователь|Ассистент):\s/,                                   // эхо истории промта
      /^(user|assistant)$/i,                                            // маркеры ролей
      /^codex$/,                                                        // маркер ответа codex (без флага i: ответ модели обычно "Codex")
    ];
    return noise.some((re) => re.test(trimmed)) ? null : raw;
  }
}

/**
 * Runtime-ветка: streamMode "custom", события {type:"log-delta"|"error"}.
 * Лог проходит фильтр шума и собирается в один фрагмент (text-start/.../text-end).
 */
export async function* runtimeChatUIMessages(events: GraphEvents): AsyncGenerator<UIChunk> {
  const filter = new RuntimeLogNoiseFilter();
  let opened = false;
  const emit = async function* (text: string): AsyncGenerator<UIChunk> {
    if (!text) return;
    if (!opened) {
      yield { type: "text-start", id: "0" };
      opened = true;
    }
    yield { type: "text-delta", id: "0", delta: text };
  };
  for await (const item of events) {
    const { payload } = eventPayload(item);
    const event = payload as { type?: string; delta?: string; errorText?: string } | undefined;
    if (event?.type === "log-delta" && event.delta) {
      yield* emit(filter.push(event.delta));
    } else if (event?.type === "error") {
      yield { type: "error", errorText: event.errorText ?? "запуск рантайма не выполнен" };
    }
  }
  yield* emit(filter.flush());
  if (opened) yield { type: "text-end", id: "0" };
}
