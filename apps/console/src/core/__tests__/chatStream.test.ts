import { describe, expect, test } from "bun:test";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { providerChatUIMessages, runtimeChatUIMessages, RuntimeLogNoiseFilter, type ChatStreamUsage } from "@/core/agent/chatStream";

async function* events(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item;
}

async function collect(generator: AsyncGenerator<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const chunk of generator) out.push(chunk);
  return out;
}

function modelMessage(content: string, toolCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>): AIMessage {
  return new AIMessage({
    content,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
    usage_metadata: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
  });
}

describe("providerChatUIMessages: стрим графа -> части UIMessage", () => {
  test("токены -> текстовые фрагменты, обновления узлов -> tool-части и usage", async () => {
    const usage: ChatStreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const items = [
      ["messages", [{ content: "при" }, {}]],
      ["messages", [{ content: "вет" }, {}]],
      ["updates", { model: { messages: [modelMessage("привет", [{ id: "c1", name: "read_file", args: { path: "a.txt" } }])] } }],
      ["updates", { tools: { messages: [new ToolMessage({ content: "hello", tool_call_id: "c1", name: "read_file" })] } }],
      ["messages", [{ content: "готово" }, {}]],
      ["updates", { model: { messages: [modelMessage("готово")] } }],
    ];
    const chunks = await collect(providerChatUIMessages(events(items), usage));
    const types = chunks.map((chunk) => chunk.type);
    expect(types).toEqual([
      "start",
      "text-start", "text-delta", "text-delta",
      "text-end",
      "tool-input-available",
      "tool-output-available",
      "text-start", "text-delta",
      "text-end",
      "finish",
    ]);
    expect(chunks[3]).toEqual({ type: "text-delta", id: "0", delta: "вет" });
    expect(chunks[5]).toMatchObject({ type: "tool-input-available", toolCallId: "c1", toolName: "read_file", input: { path: "a.txt" }, dynamic: true });
    expect(chunks[6]).toMatchObject({ type: "tool-output-available", toolCallId: "c1", output: "hello" });
    expect(chunks[8]).toEqual({ type: "text-delta", id: "1", delta: "готово" });
    // расход накоплен по обоим сообщениям модели
    expect(usage).toEqual({ inputTokens: 14, outputTokens: 6, totalTokens: 20 });
  });

  test("модель без потоковой выдачи: текст приходит из обновления узла", async () => {
    const usage: ChatStreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const items = [["updates", { model: { messages: [modelMessage("цельный ответ")] } }]];
    const chunks = await collect(providerChatUIMessages(events(items), usage));
    const types = chunks.map((chunk) => chunk.type);
    expect(types).toEqual(["start", "text-start", "text-delta", "text-end", "finish"]);
    expect(chunks[2]).toEqual({ type: "text-delta", id: "0", delta: "цельный ответ" });
  });

  test("вызов инструмента без id получает синтезированный идентификатор", async () => {
    const usage: ChatStreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const items = [["updates", { model: { messages: [modelMessage("", [{ name: "list_dir", args: {} }])] } }]];
    const chunks = await collect(providerChatUIMessages(events(items), usage));
    expect(chunks[1]).toMatchObject({ type: "tool-input-available", toolName: "list_dir" });
    expect(String(chunks[1]?.toolCallId)).toMatch(/^call_\d+$/);
  });
});

describe("runtimeChatUIMessages: лог-события -> текстовый фрагмент", () => {
  test("дельты проходят через фильтр шума, ошибка -> error-часть", async () => {
    const items = [
      { type: "log-delta", delta: "при" },
      { type: "log-delta", delta: "2026-10-02T21:00:00Z ERROR codex_core: x\nвет\n" },
      { type: "error", errorText: "нет CLI" },
    ];
    const chunks = await collect(runtimeChatUIMessages(events(items)));
    const types = chunks.map((chunk) => chunk.type);
    // строка диагностики отфильтрована; чистые строки одного прироста идут одной дельтой
    expect(types).toEqual(["text-start", "text-delta", "error", "text-end"]);
    expect(chunks[1]).toEqual({ type: "text-delta", id: "0", delta: "при2026-10-02T21:00:00Z ERROR codex_core: x\nвет\n" });
    expect(chunks[2]).toEqual({ type: "error", errorText: "нет CLI" });
  });

  test("кортежи [mode, payload] нормализуются как payload", async () => {
    const chunks = await collect(runtimeChatUIMessages(events([["custom", { type: "log-delta", delta: "x" }]])));
    expect(chunks.map((chunk) => chunk.type)).toEqual(["text-start", "text-delta", "text-end"]);
  });
});

describe("RuntimeLogNoiseFilter: шум codex-лога", () => {
  test("баннер, диагностика, эхо промта и расход токенов отфильтрованы, ответ проходит", () => {
    const f = new RuntimeLogNoiseFilter();
    const log = [
      "Reading additional input from stdin...",
      "2026-10-02T22:09:47.410Z ERROR codex_core::session::session: failed to load skill",
      "2026-10-02T22:09:48.063Z ERROR codex_api::endpoint::responses_websocket: failed to connect: 426",
      "ERROR rmcp::transport::worker: worker quit with fatal",
      "OpenAI Codex v0.160.0",
      "--------",
      "workdir: /repo model: gpt-5.6-sol provider: openai approval: never sandbox: read-only reasoning effort: medium",
      "--------",
      "user",
      "Пользователь: Ответь одним словом: работает",
      "codex",
      "работает",
      "tokens used",
      "23,022",
      "работает",
    ].join("\n") + "\n";
    // подача кусками с разрывом посреди строки
    let out = "";
    out += f.push(log.slice(0, 53));
    out += f.push(log.slice(53, 160));
    out += f.push(log.slice(160));
    out += f.flush();
    expect(out.trim()).toBe("работает");
  });

  test("ответ модели без шума проходит без изменений", () => {
    const f = new RuntimeLogNoiseFilter();
    let out = f.push("первая строка ответа\n");
    out += f.push("вторая строка");
    out += f.flush();
    expect(out).toBe("первая строка ответа\nвторая строка");
  });
});

describe("RuntimeLogNoiseFilter: JSONL-стрим codex (--json)", () => {
  test("текст ответа извлекается из item.completed, служебные события отбрасываются", () => {
    const f = new RuntimeLogNoiseFilter();
    const log = [
      '{"type":"thread.started","thread_id":"01a0fec1"}',
      '{"type":"turn.started"}',
      '2026-10-02T22:30:00Z ERROR codex_rmcp_client::oauth: cannot be refreshed',
      '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Сначала проверю настройки"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"exec /bin/zsh -lc \'node guard.mjs settings\'","aggregated_output":"AGENT RUNTIME SETTINGS"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"GPT"}}',
      '{"type":"turn.completed","usage":{"input_tokens":23012,"output_tokens":6}}',
    ].join("\n") + "\n";
    let out = f.push(log.slice(0, 80));
    out += f.push(log.slice(80, 200));
    out += f.push(log.slice(200));
    out += f.flush();
    expect(out.trim()).toBe("GPT");
  });

  test("строка-ответ, начинающаяся с { и не являющаяся JSON-событием, сохраняется", () => {
    const f = new RuntimeLogNoiseFilter();
    const out = f.push("{не JSON, а часть ответа}\n") + f.flush();
    expect(out).toBe("{не JSON, а часть ответа}\n");
  });
});
