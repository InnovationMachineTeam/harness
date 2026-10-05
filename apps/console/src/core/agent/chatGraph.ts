import { open } from "node:fs/promises";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel, BindToolsInput } from "@langchain/core/language_models/chat_models";
import { END, getWriter, MessagesAnnotation, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { dispatchTool, type LoopTool } from "../agentLoop";
import type { ToolContext } from "../agentTools";
import { processAlive } from "../memory";

/**
 * LangGraph-графы direct-чата вкладки "Агент". Обе ветки роута /api/agent/chat
 * исполняются как граф: провайдерная - узлы "model" (LangChain-модель с
 * привязанными инструментами) и "tools" (исполнение через core/agentTools.ts
 * и MCP-клиент); runtime - один узел, запускающий headless-CLI и стримящий
 * хвост его лога через custom-события. Потребление стрима - core/agent/chatStream.ts.
 */

/** Лимит шагов модели на реплику (ранее stepCountIs(10) в AI SDK). */
export const CHAT_MAX_MODEL_STEPS = 10;

const RUN_POLL_MS = 500;
/** Общий бюджет стрима лога runtime-запуска. */
export const RUN_TIMEOUT_MS = 15 * 60_000;

/** История реплик UIMessage -> сообщения LangChain: только текстовые части. */
export function historyToLcMessages(messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const message of messages) {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part as { text?: string }).text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    out.push(message.role === "user" ? new HumanMessage(text) : new AIMessage(text));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Прочитать новый хвост лог-файла от offset; файл может ещё не существовать. */
export async function readLogTail(logFile: string, offset: number): Promise<{ chunk: string; next: number }> {
  const fh = await open(logFile, "r").catch(() => null);
  if (!fh) return { chunk: "", next: offset };
  try {
    const size = (await fh.stat()).size;
    if (size <= offset) return { chunk: "", next: offset };
    const len = size - offset;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, offset);
    return { chunk: buf.toString("utf8"), next: size };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** Минимальный контракт потоковой модели: токены попадают в streamMode "messages". */
interface StreamableModel {
  stream(messages: BaseMessage[], config?: { signal?: AbortSignal }): Promise<AsyncIterable<AIMessageChunk>>;
}

/** Схемы инструментов в OpenAI-формате - модели всех kind конвертируют их сами. */
function toolSpecs(tools: LoopTool[]): BindToolsInput[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export interface ProviderChatGraphOptions {
  model: BaseChatModel;
  /** Системный промт (инструкции + правила спеки json-render). */
  system: string;
  /** Инструменты агентного цикла: встроенные + MCP. */
  tools: LoopTool[];
  ctx: ToolContext;
  /** Исполнитель MCP-инструментов; нет - только встроенные. */
  callMcp?: (qualifiedName: string, args: unknown) => Promise<{ ok: boolean; output: string }>;
  maxModelSteps?: number;
}

/**
 * Граф провайдерной ветки: "model" -> ("tools" -> "model")* -> END.
 * Останавливается на ответе без вызовов инструментов или по лимиту шагов.
 */
export function buildProviderChatGraph(opts: ProviderChatGraphOptions) {
  const modelNode = async (state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) => {
    const specs = toolSpecs(opts.tools);
    const model = opts.model;
    const bound = (specs.length && model.bindTools ? model.bindTools(specs) : model) as unknown as StreamableModel;
    let response: AIMessageChunk | undefined;
    for await (const chunk of await bound.stream([new SystemMessage(opts.system), ...state.messages], { signal: config.signal })) {
      response = response ? response.concat(chunk) : chunk;
    }
    const aggregated = (response ?? new AIMessage("")) as AIMessageChunk;
    const calls = aggregated.tool_calls ?? [];
    // вызовы без id нельзя связать с ToolMessage - синтезируем детерминированно
    const message = calls.some((call) => !call.id)
      ? new AIMessage({ content: aggregated.content, tool_calls: calls.map((call, index) => ({ ...call, id: call.id ?? `call_${index}` })) })
      : aggregated;
    return { messages: [message] };
  };

  const toolNode = async (state: typeof MessagesAnnotation.State) => {
    const last = state.messages.at(-1) as AIMessage;
    const out: ToolMessage[] = [];
    for (const call of last.tool_calls ?? []) {
      const id = call.id ?? `call_${out.length}`;
      const result = await dispatchTool({
        ctx: opts.ctx,
        call: { id, name: call.name, args: call.args, rawArgs: JSON.stringify(call.args ?? {}) },
        callMcp: opts.callMcp,
      });
      out.push(new ToolMessage({ content: result.output, tool_call_id: id, name: call.name }));
    }
    return { messages: out };
  };

  const route = (state: typeof MessagesAnnotation.State): "tools" | typeof END => {
    const last = state.messages.at(-1);
    if (!(last instanceof AIMessage) || !(last.tool_calls ?? []).length) return END;
    const steps = state.messages.filter((message) => message instanceof AIMessage).length;
    return steps >= (opts.maxModelSteps ?? CHAT_MAX_MODEL_STEPS) ? END : "tools";
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("model", modelNode)
    .addNode("tools", toolNode)
    .addEdge(START, "model")
    .addConditionalEdges("model", route, ["tools", END])
    .addEdge("tools", "model")
    .compile();
}

export interface RuntimeChatGraphOptions {
  /** Запуск headless-CLI (launchPromptRun); выполняется внутри узла графа. */
  launch: () => Promise<{ ok: true; pid: number | null; logFile: string } | { ok: false; detail: string }>;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Граф runtime-ветки: один узел "runtime" запускает headless-CLI и, пока
 * процесс жив, пишет прирост лога в custom-события {type:"log-delta"}.
 */
export function buildRuntimeChatGraph(opts: RuntimeChatGraphOptions) {
  const runtimeNode = async (_state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) => {
    const writer = getWriter(config);
    const launch = await opts.launch();
    if (!launch.ok) {
      writer?.({ type: "error", errorText: launch.detail });
      return { messages: [] };
    }
    let offset = 0;
    let text = "";
    const startedAt = Date.now();
    while (Date.now() - startedAt < (opts.timeoutMs ?? RUN_TIMEOUT_MS)) {
      const { chunk, next } = await readLogTail(launch.logFile, offset);
      if (chunk) {
        offset = next;
        text += chunk;
        writer?.({ type: "log-delta", delta: chunk });
      }
      if (launch.pid === null || !processAlive(launch.pid)) {
        // финальное чтение: процесс мог дописать лог перед выходом
        const tail = await readLogTail(launch.logFile, offset);
        if (tail.chunk) {
          text += tail.chunk;
          writer?.({ type: "log-delta", delta: tail.chunk });
        }
        break;
      }
      await sleep(opts.pollMs ?? RUN_POLL_MS);
    }
    return { messages: [new AIMessage(text)] };
  };
  return new StateGraph(MessagesAnnotation).addNode("runtime", runtimeNode).addEdge(START, "runtime").addEdge("runtime", END).compile();
}
