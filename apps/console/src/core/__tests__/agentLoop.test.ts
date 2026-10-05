import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { BaseChatModel, type BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { builtinLoopTools, loopReceiptId, runAgentLoop, type LoopTool, type ToolCall } from "@/core/agentLoop";
import { emptyProviderEntry, providerPresetById, type ProviderEntry } from "@/core/providers";

/** Корень репозитория: read_file в цикле проходит настоящую guard-политику. */
const repoRoot = resolve(import.meta.dir, "../../../../..");

const openai = providerPresetById("openai")!;

function entry(kind: "openai" | "anthropic" | "gemini"): ProviderEntry {
  const preset = providerPresetById(kind === "openai" ? "openai" : kind === "anthropic" ? "anthropic" : "gemini")!;
  // Ключ не задаётся: модель подменяется в тестах, авторизация не проверяется.
  return {
    ...emptyProviderEntry(preset),
    baseUrl: "https://api.test/v1",
    models: { ...emptyProviderEntry(preset).models, standard: "test-model" },
  };
}

/** Фейковая модель: очередь ответов, журнал полученных сообщений; bindTools возвращает саму себя. */
class FakeChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  queue: AIMessage[];
  received: BaseMessage[][] = [];
  constructor(queue: AIMessage[]) {
    super({});
    this.queue = queue;
  }
  _llmType(): string {
    return "fake";
  }
  async _generate(messages: BaseMessage[]) {
    this.received.push(messages);
    const next = this.queue.shift();
    if (!next) throw new Error("очередь ответов модели пуста");
    return { generations: [{ text: typeof next.content === "string" ? next.content : "", message: next }] };
  }
  override bindTools(): FakeChatModel {
    return this;
  }
}

/** AIMessage с метаданными расхода. */
function aimessage(content: string, toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [], usage?: { input: number; output: number }): AIMessage {
  return new AIMessage({
    content,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    ...(usage
      ? { usage_metadata: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output } }
      : {}),
  });
}

describe("runAgentLoop: цикл на подменённой модели", () => {
  test("вызов инструмента возвращается в контекст, финальный текст - результат", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-loop-"));
    try {
      await writeFile(join(dir, "a.txt"), "hello-loop\n", "utf8");
      const model = new FakeChatModel([
        aimessage("смотрю файл", [{ id: "call-1", name: "read_file", args: { path: "a.txt" } }], { input: 10, output: 5 }),
        aimessage("готово: hello-loop", [], { input: 20, output: 4 }),
      ]);
      const toolEvents: string[] = [];
      const result = await runAgentLoop({
        repoRoot,
        providerId: "openai",
        preset: openai,
        entry: entry("openai"),
        model: "test-model",
        prompt: "прочитай a.txt",
        toolCwd: dir,
        timeoutMs: 30_000,
        logFile: join(dir, "transcript.log"),
        buildModel: () => model,
        onToolCall: (event) => toolEvents.push(`${event.tool}:${event.ok ? "ok" : "error"}`),
      });
      expect(result.ok).toBe(true);
      expect(result.text).toBe("готово: hello-loop");
      expect(result.usage.rounds).toBe(2);
      expect(result.usage.toolCalls).toBe(1);
      expect(result.usage.inputTokens).toBe(30);
      expect(result.usage.outputTokens).toBe(9);
      expect(toolEvents).toEqual(["read_file:ok"]);
      // Второй запрос содержит результат инструмента как ToolMessage.
      const toolMessage = model.received[1]?.find((message) => message instanceof ToolMessage) as ToolMessage | undefined;
      expect(String(toolMessage?.content)).toContain("hello-loop");
      expect(toolMessage?.tool_call_id).toBe("call-1");
      // Первый запрос: пользовательское сообщение без инструментов в истории.
      expect(model.received[0]?.[0]).toBeInstanceOf(HumanMessage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("инструменты передаются модели через bindTools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-loop-tools-"));
    try {
      let bound: unknown = null;
      const model = new FakeChatModel([aimessage("готово")]);
      const original = model.bindTools.bind(model);
      model.bindTools = ((specs: unknown) => {
        bound = specs;
        return original();
      }) as typeof model.bindTools;
      const result = await runAgentLoop({
        repoRoot,
        providerId: "openai",
        preset: openai,
        entry: entry("openai"),
        model: "test-model",
        prompt: "задание",
        toolCwd: dir,
        timeoutMs: 10_000,
        logFile: join(dir, "transcript.log"),
        buildModel: () => model,
      });
      expect(result.ok).toBe(true);
      const specs = bound as Array<{ type: string; function: { name: string } }>;
      expect(specs[0]?.type).toBe("function");
      expect(specs[0]?.function?.name).toBe("read_file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ошибка модели - ok:false с текстом", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-loop-err-"));
    try {
      const model = new FakeChatModel([]);
      const result = await runAgentLoop({
        repoRoot,
        providerId: "openai",
        preset: openai,
        entry: entry("openai"),
        model: "test-model",
        prompt: "задание",
        toolCwd: dir,
        timeoutMs: 10_000,
        logFile: join(dir, "transcript.log"),
        buildModel: () => model,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("модели пуста");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("лимит раундов останавливает цикл без финального ответа", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-loop-cap-"));
    try {
      const model = new FakeChatModel([
        aimessage("", [{ id: "c1", name: "list_dir", args: {} }]),
        aimessage("", [{ id: "c2", name: "list_dir", args: {} }]),
      ]);
      const result = await runAgentLoop({
        repoRoot,
        providerId: "openai",
        preset: openai,
        entry: entry("openai"),
        model: "test-model",
        prompt: "задание",
        toolCwd: dir,
        timeoutMs: 30_000,
        maxRounds: 2,
        logFile: join(dir, "transcript.log"),
        buildModel: () => model,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("лимит раундов");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** Ответ chat/completions в формате OpenAI. */
function openaiResponse(body: unknown): string {
  return JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    ...((body as Record<string, unknown>) ?? {}),
  });
}

/** Подмена глобального fetch: очередь ответов и журнал тел запросов. */
const originalFetch = globalThis.fetch;
function fakeFetch(queue: string[], bodies: string[]): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const next = queue.shift();
    if (next === undefined) throw new Error("неожиданный вызов fetch");
    return new Response(next, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("runAgentLoop: сквозной прогон через ChatOpenAI", () => {
  test("openai-совместимый провайдер: tool_calls из HTTP-ответа попадают в цикл", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-loop-http-"));
    try {
      await writeFile(join(dir, "a.txt"), "hello-http\n", "utf8");
      const bodies: string[] = [];
      globalThis.fetch = fakeFetch([
        openaiResponse({
          choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.txt\"}" } }] }, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        openaiResponse({
          choices: [{ index: 0, message: { role: "assistant", content: "готово: hello-http" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
        }),
      ], bodies);
      const result = await runAgentLoop({
        repoRoot,
        providerId: "openai",
        preset: openai,
        entry: entry("openai"),
        model: "test-model",
        prompt: "прочитай a.txt",
        toolCwd: dir,
        timeoutMs: 30_000,
        logFile: join(dir, "transcript.log"),
      });
      expect(result.ok).toBe(true);
      expect(result.text).toBe("готово: hello-http");
      expect(result.usage.toolCalls).toBe(1);
      expect(result.usage.inputTokens).toBe(30);
      // Второй запрос: в истории присутствует сообщение роли tool с результатом.
      const second = JSON.parse(bodies[1] ?? "{}") as { messages: Array<{ role: string; content: string }> };
      expect(second.messages?.some((message) => message.role === "tool" && message.content.includes("hello-http"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loopReceiptId", () => {
  test("детерминирован и различает наборы", () => {
    expect(loopReceiptId(["a", 1])).toBe(loopReceiptId(["a", 1]));
    expect(loopReceiptId(["a", 1])).not.toBe(loopReceiptId(["a", 2]));
  });
});

describe("тип ToolCall", () => {
  test("структура вызова инструмента", () => {
    const call: ToolCall = { id: "c", name: "read_file", args: {}, rawArgs: "{}" };
    expect(call.name).toBe("read_file");
  });
});

describe("builtinLoopTools", () => {
  test("спеки встроенных инструментов с JSON-схемами", () => {
    const tools: LoopTool[] = builtinLoopTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.name && tool.description && typeof tool.parameters === "object")).toBe(true);
  });
});
