import { describe, expect, test } from "bun:test";
import { aguiFrame, aguiMessageToUiMessage, threadIdToChatId, uiChunksToAguiEvents } from "@/core/agui/adapter";

async function collect(generator: AsyncGenerator<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

async function* chunks(items: Array<Record<string, unknown>>): AsyncGenerator<Record<string, unknown>> {
  for (const item of items) yield item;
}

describe("адаптер AG-UI", () => {
  test("текст стримится триадой Start/Content/End между границами прогона", async () => {
    const events = await collect(uiChunksToAguiEvents(chunks([
      { type: "start" },
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: "при" },
      { type: "text-delta", id: "0", delta: "вет" },
      { type: "text-end", id: "0" },
      { type: "finish", finishReason: "stop" },
    ]), { threadId: "t-1", runId: "r-1" }));
    expect(events.map((event) => event.type)).toEqual([
      "RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED",
    ]);
    expect(events[0]).toMatchObject({ threadId: "t-1", runId: "r-1" });
    expect(events[2]).toMatchObject({ messageId: "msg-0", delta: "при" });
  });

  test("вызов инструмента - Start/Args/End полными аргументами, затем Result", async () => {
    const events = await collect(uiChunksToAguiEvents(chunks([
      { type: "start" },
      { type: "tool-input-available", toolCallId: "call_1", toolName: "read_file", input: { path: "a.ts" } },
      { type: "tool-output-available", toolCallId: "call_1", output: "содержимое" },
      { type: "finish", finishReason: "stop" },
    ]), { threadId: "t", runId: "r" }));
    const types = events.map((event) => event.type);
    expect(types).toEqual(["RUN_STARTED", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT", "RUN_FINISHED"]);
    expect(events[2]).toMatchObject({ toolCallId: "call_1", delta: "{\"path\":\"a.ts\"}" });
    expect(events[4]).toMatchObject({ toolCallId: "call_1", content: "содержимое" });
  });

  test("ошибка завершает прогон событием RUN_ERROR", async () => {
    const events = await collect(uiChunksToAguiEvents(chunks([
      { type: "start" },
      { type: "error", errorText: "запуск не выполнен" },
      { type: "finish", finishReason: "stop" },
    ]), { threadId: "t", runId: "r" }));
    expect(events.at(-1)).toMatchObject({ type: "RUN_ERROR", message: "запуск не выполнен" });
  });

  test("неизвестные части (data-spec) пропускаются без разрыва прогона", async () => {
    const events = await collect(uiChunksToAguiEvents(chunks([
      { type: "data-spec", id: "spec-1", data: {} },
      { type: "finish", finishReason: "stop" },
    ]), { threadId: "t", runId: "r" }));
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  test("кадр SSE - data-only с LF", () => {
    expect(aguiFrame({ type: "RUN_FINISHED" })).toBe('data: {"type":"RUN_FINISHED"}\n\n');
  });
});

describe("сообщения и threadId", () => {
  test("сообщение AG-UI конвертируется в реплику UIMessage", () => {
    expect(aguiMessageToUiMessage({ id: "m1", role: "user", content: "привет" })).toEqual({
      role: "user",
      parts: [{ type: "text", text: "привет" }],
    });
    expect(aguiMessageToUiMessage({ role: "assistant", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toEqual({
      role: "assistant",
      parts: [{ type: "text", text: "ab" }],
    });
    expect(aguiMessageToUiMessage({ role: "user", content: "  " })).toBeNull();
  });

  test("threadId отображается в безопасный id direct-чата", () => {
    expect(threadIdToChatId("abc-123")).toBe("direct-agui-abc-123");
    expect(threadIdToChatId("путь/с/слэшами")).toBe("direct-agui-thread");
    expect(threadIdToChatId("t_1")).toMatch(/^direct-agui-t-1$/);
  });
});
