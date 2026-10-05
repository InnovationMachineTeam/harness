import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { BaseChatModel, type BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { buildProviderChatGraph, buildRuntimeChatGraph, historyToLcMessages, readLogTail } from "@/core/agent/chatGraph";
import { builtinLoopTools, type LoopTool } from "@/core/agentLoop";

/** Корень репозитория: read_file в узле tools проходит настоящую guard-политику. */
const repoRoot = resolve(import.meta.dir, "../../../../..");

/** Фейковая модель: очередь ответов; bindTools возвращает саму себя. */
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

describe("buildProviderChatGraph: цикл model-tools-model", () => {
  test("вызов инструмента возвращается модели, финал - ответ без tool_calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chat-graph-"));
    try {
      await writeFile(join(dir, "a.txt"), "hello-graph\n", "utf8");
      const model = new FakeChatModel([
        new AIMessage({ content: "смотрю", tool_calls: [{ id: "c1", name: "read_file", args: { path: "a.txt" } }] }),
        new AIMessage("готово: hello-graph"),
      ]);
      const graph = buildProviderChatGraph({
        model,
        system: "тестовый системный промт",
        tools: builtinLoopTools(),
        ctx: { cwd: dir, repoRoot },
      });
      const updates: Array<Record<string, { messages?: BaseMessage[] }>> = [];
      const events = (await graph.stream(
        { messages: [new HumanMessage("прочитай a.txt")] },
        { streamMode: ["updates"], recursionLimit: 10 },
      )) as unknown as AsyncIterable<[string, Record<string, { messages?: BaseMessage[] }>]>;
      for await (const [, payload] of events) updates.push(payload);
      // узлы model -> tools -> model
      expect(Object.keys(updates[0] ?? {})).toEqual(["model"]);
      expect(Object.keys(updates[1] ?? {})).toEqual(["tools"]);
      expect(Object.keys(updates[2] ?? {})).toEqual(["model"]);
      const toolOut = updates[1]?.tools?.messages?.[0] as ToolMessage | undefined;
      expect(String(toolOut?.content)).toContain("hello-graph");
      expect(toolOut?.tool_call_id).toBe("c1");
      const final = updates[2]?.model?.messages?.[0] as AIMessage | undefined;
      expect(String(final?.content)).toBe("готово: hello-graph");
      // системный промт был первым сообщением при вызове модели
      expect(model.received[0]?.[0]?.content).toContain("тестовый системный промт");
      // история реплик UIMessage -> текстовые сообщения LangChain
      const history = historyToLcMessages([
        { role: "user", parts: [{ type: "text", text: "вопрос" }] },
        { role: "assistant", parts: [{ type: "text", text: "ответ" }, { type: "tool-read_file" }] },
      ]);
      expect(history).toHaveLength(2);
      expect(history[0]?.content).toBe("вопрос");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ответ без tool_calls завершает граф одним узлом model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chat-graph-final-"));
    try {
      const model = new FakeChatModel([new AIMessage("прямой ответ")]);
      const graph = buildProviderChatGraph({ model, system: "тест", tools: builtinLoopTools(), ctx: { cwd: dir, repoRoot } });
      const updates: Array<Record<string, { messages?: BaseMessage[] }>> = [];
      const events = (await graph.stream(
        { messages: [new HumanMessage("задание")] },
        { streamMode: ["updates"], recursionLimit: 10 },
      )) as unknown as AsyncIterable<[string, Record<string, { messages?: BaseMessage[] }>]>;
      for await (const [, payload] of events) updates.push(payload);
      expect(updates).toHaveLength(1);
      expect(String((updates[0]?.model?.messages?.[0] as AIMessage | undefined)?.content)).toBe("прямой ответ");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildRuntimeChatGraph: узел запуска и стрима лога", () => {
  test("ошибка запуска уходит в custom-событие error", async () => {
    const graph = buildRuntimeChatGraph({
      launch: async () => ({ ok: false, detail: "нет CLI", runtime: "test", logFile: "", pid: null }),
    });
    const events = (await graph.stream({ messages: [] }, { streamMode: "custom" })) as unknown as AsyncIterable<unknown>;
    const collected: unknown[] = [];
    for await (const item of events) collected.push(item);
    expect(collected).toEqual([{ type: "error", errorText: "нет CLI" }]);
  });

  test("живой процесс: дельты лога до завершения, финальное чтение", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chat-graph-runtime-"));
    try {
      const logFile = join(dir, "run.log");
      // процесс-писатель: stdout/stderr рантайма в launchPromptRun идут в лог-файл;
      // здесь то же самое - процесс создаёт лог, пауза, дописывает и завершается
      const { spawn } = await import("node:child_process");
      const child = spawn("sh", ["-c", `printf 'строка-1\\n' > '${logFile}'; sleep 0.3; printf 'строка-2\\n' >> '${logFile}'`], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      const graph = buildRuntimeChatGraph({
        launch: async () => ({ ok: true, runtime: "test", logFile, pid: child.pid ?? null }),
        pollMs: 50,
        timeoutMs: 10_000,
      });
      const events = (await graph.stream({ messages: [] }, { streamMode: "custom" })) as unknown as AsyncIterable<{ type: string; delta?: string }>;
      let text = "";
      for await (const event of events) {
        if (event.type === "log-delta" && event.delta) text += event.delta;
      }
      expect(text).toContain("строка-1");
      expect(text).toContain("строка-2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readLogTail", () => {
  test("возвращает прирост от offset и новый сдвиг", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chat-graph-tail-"));
    try {
      const file = join(dir, "log.txt");
      const { writeFile: write } = await import("node:fs/promises");
      await write(file, "line-1\n", "utf8");
      const first = await readLogTail(file, 0);
      expect(first.chunk).toBe("line-1\n");
      expect(first.next).toBe(7);
      await write(file, "line-2\n", { flag: "a" });
      const second = await readLogTail(file, first.next);
      expect(second.chunk).toBe("line-2\n");
      // несуществующий файл - пустой результат
      const missing = await readLogTail(join(dir, "нет-файла"), 0);
      expect(missing).toEqual({ chunk: "", next: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("типы LoopTool", () => {
  test("инструменты цикла совместимы со схемами графа", () => {
    const tools: LoopTool[] = builtinLoopTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
