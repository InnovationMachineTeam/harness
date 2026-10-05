import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel, BindToolsInput } from "@langchain/core/language_models/chat_models";
import { executeTool, BUILTIN_TOOL_SPECS, type ToolContext, type ToolResult } from "./agentTools";
import { withProviderAuth } from "./providerAuth";
import { parseMcpQualifiedName } from "./mcp/client";
import { chatModelForProvider, CHAT_REQUEST_TIMEOUT_MS } from "./langchain/chatModel";

/**
 * Агентный цикл (function calling) для провайдеров из реестра консоли.
 * Запросы к модели идут через LangChain (core/langchain/chatModel.ts по kind
 * пресета), схема инструментов передаётся через bindTools, вызовы моделей
 * исполняются исполнителями core/agentTools.ts и MCP-клиентом, результаты
 * возвращаются в контекст следующего раунда. Цикл останавливается на ответе
 * без вызовов инструментов, при исчерпании лимита раундов или бюджета времени.
 */

/** Лимит раундов цикла по умолчанию. */
export const DEFAULT_MAX_ROUNDS = 10;

/** Потолок вызовов инструментов за цикл (защита от зацикливания модели). */
export const MAX_TOOL_CALLS = 50;

/** Потолок вывода инструмента, попадающего в контекст следующего раунда. */
export const MAX_TOOL_OUTPUT_CHARS = 32_000;

/** Вызов инструмента в терминах ответа модели. */
export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  /** Аргументы в JSON (совместимость с прошлым форматом транскрипта). */
  rawArgs: string;
}

type LoopMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; call: ToolCall; text: string };

export interface LoopTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentLoopUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  rounds: number;
  toolCalls: number;
}

export interface AgentLoopResult {
  ok: boolean;
  /** Финальный текст ответа; пустой при ошибке цикла. */
  text: string;
  error?: string;
  usage: AgentLoopUsage;
  transcriptFile: string;
}

export interface AgentLoopOptions {
  repoRoot: string;
  providerId: string;
  preset: import("./providers").ProviderPreset;
  entry: import("./providers").ProviderEntry;
  model: string;
  /** Системный промт (роль шага, internal skills); идёт первым сообщением перед историей. */
  system?: string;
  /** Первое сообщение пользователя (промт секции). */
  prompt: string;
  /** Рабочая папка инструментов: изоляция путей и cwd run_command. */
  toolCwd: string;
  /** Общий бюджет цикла (timeoutMs шага). */
  timeoutMs: number;
  maxRounds?: number;
  /** Дополнительные инструменты MCP (полные имена mcp__<server>__<tool>). */
  mcpTools?: LoopTool[];
  /** Исполнитель MCP-инструментов (core/mcp/client.ts); нет - только встроенные. */
  callMcp?: (qualifiedName: string, args: unknown) => Promise<{ ok: boolean; output: string }>;
  /** Наблюдатель вызовов инструментов (события ledger). */
  onToolCall?: (event: ToolCallEvent) => void;
  logFile?: string;
  /** Подмена сборщика модели для тестов; в продакшене не задаётся. */
  buildModel?: (tools: LoopTool[], token: string, fetchImpl: typeof fetch | undefined, signal: AbortSignal) => BaseChatModel;
}

export interface ToolCallEvent {
  tool: string;
  args: string;
  ok: boolean;
  blocked: boolean;
  outputSize: number;
  /** Отрывок результата для privacy=full; в остальных режимах не включается. */
  excerpt?: string;
  error?: string;
  durationMs: number;
}

/** Спецификации встроенных инструментов как набор для цикла. */
export function builtinLoopTools(): LoopTool[] {
  return BUILTIN_TOOL_SPECS.map((spec) => ({ name: spec.name, description: spec.description, parameters: spec.parameters }));
}

/* ------------------------------ сообщения и разбор ответа ------------------------------ */

function toLcMessages(messages: LoopMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === "user") return new HumanMessage(message.text);
    if (message.role === "assistant") {
      return new AIMessage({
        content: message.text,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          args: (call.args ?? {}) as Record<string, unknown>,
        })),
      });
    }
    return new ToolMessage({ content: message.text, tool_call_id: message.call.id, name: message.call.name });
  });
}

function textOfResponse(message: AIMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((block) => (typeof block === "string" ? block : (block as { text?: string }).text ?? ""))
      .join("");
  }
  return "";
}

function toolCallsOfResponse(message: AIMessage, round: number): ToolCall[] {
  return (message.tool_calls ?? [])
    .map((call, index) => ({
      id: String(call.id ?? `call_${round}_${index}`),
      name: String(call.name ?? ""),
      args: call.args,
      rawArgs: JSON.stringify(call.args ?? {}),
    }))
    .filter((call) => call.name);
}

function accumulateUsage(message: AIMessage, usage: AgentLoopUsage): void {
  const meta = message.usage_metadata;
  if (!meta) return;
  usage.inputTokens += meta.input_tokens ?? 0;
  usage.outputTokens += meta.output_tokens ?? 0;
  usage.totalTokens += meta.total_tokens ?? 0;
  usage.cacheTokens += Number(meta.input_token_details?.cache_read ?? 0);
}

/** HTTP-статус ошибки модели (SDK провайдеров кладут его в поле status). */
function httpStatusOfError(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** Схема инструментов в OpenAI-формате: модели всех kind конвертируют её сами. */
function toolSpecs(tools: LoopTool[]): BindToolsInput[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/* ---------------------------------- цикл ---------------------------------- */

/** Вызов инструмента: MCP-имена идут в MCP-клиент, остальные - в core/agentTools.ts. */
export async function dispatchTool(opts: {
  ctx: ToolContext;
  call: ToolCall;
  callMcp?: (qualifiedName: string, args: unknown) => Promise<{ ok: boolean; output: string }>;
}): Promise<ToolResult> {
  const startedAt = Date.now();
  if (parseMcpQualifiedName(opts.call.name)) {
    if (!opts.callMcp) {
      return { ok: false, output: `MCP-инструменты не подключены: ${opts.call.name}`, blocked: true, durationMs: Date.now() - startedAt };
    }
    const result = await opts.callMcp(opts.call.name, opts.call.args).catch((error) => ({
      ok: false,
      output: `вызов MCP не выполнен: ${error instanceof Error ? error.message : String(error)}`,
    }));
    return { ...result, blocked: false, durationMs: Date.now() - startedAt };
  }
  return executeTool(opts.ctx, opts.call.name, opts.call.args);
}

/** Минимальный контракт вызова модели: LangChain-модели и тестовые подмены. */
type InvocableModel = {
  invoke(messages: BaseMessage[], config?: { signal?: AbortSignal }): Promise<unknown>;
};

/** Модель провайдера с привязанными инструментами (пересобирается на каждый запрос - токен может обновиться). */
function boundModel(opts: AgentLoopOptions, tools: LoopTool[], token: string, fetchImpl: typeof fetch | undefined, signal: AbortSignal): InvocableModel {
  const model = opts.buildModel
    ? opts.buildModel(tools, token, fetchImpl, signal)
    : chatModelForProvider({
        preset: opts.preset,
        entry: opts.entry,
        model: opts.model,
        token,
        fetchImpl,
      });
  const specs = toolSpecs(tools);
  return specs.length && model.bindTools ? (model.bindTools(specs) as InvocableModel) : model;
}

/**
 * Прогон агентного цикла. Никогда не бросает: ошибка запроса или бюджета
 * возвращается как ok:false с текстом для события попытки. При HTTP 401 у
 * oauth2-провайдера токен обменивается заново и раунд повторяется один раз.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxRounds = Math.max(1, opts.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const deadline = Date.now() + Math.max(1_000, opts.timeoutMs);
  const tools = [...builtinLoopTools(), ...(opts.mcpTools ?? [])];
  const ctx: ToolContext = { cwd: opts.toolCwd, repoRoot: opts.repoRoot };
  const messages: LoopMessage[] = [{ role: "user", text: opts.prompt }];
  const usage: AgentLoopUsage = { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, rounds: 0, toolCalls: 0 };
  const system = opts.system?.trim();

  const runsDir = path.join(opts.repoRoot, ".agents", "console", "runs");
  const transcriptFile = opts.logFile ?? path.join(runsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-loop-${opts.providerId}.log`);
  await mkdir(runsDir, { recursive: true }).catch(() => undefined);
  const trace = async (line: string): Promise<void> => {
    await appendFile(transcriptFile, line + "\n", "utf8").catch(() => undefined);
  };
  await trace(`# агентный цикл ${opts.providerId} (${opts.model}), инструменты: ${tools.map((tool) => tool.name).join(", ")}`);

  const fail = async (error: string): Promise<AgentLoopResult> => {
    await trace(`# ошибка: ${error}`);
    return { ok: false, text: "", error, usage, transcriptFile };
  };

  for (let round = 1; round <= maxRounds; round += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail(`бюджет времени цикла исчерпан (${opts.timeoutMs} ms)`);
    usage.rounds = round;

    // Эскалация к финальному ответу: на последних раундах предупреждаем модель,
    // на последнем - забираем инструменты, чтобы цикл гарантированно завершился текстом.
    const forceAnswer = round >= maxRounds;
    const nudge = round === maxRounds - 1
      ? "Раунды почти исчерпаны: в следующем ответе дай финальный результат текстом, без вызовов инструментов."
      : null;

    const signal = AbortSignal.timeout(Math.min(CHAT_REQUEST_TIMEOUT_MS, remaining));
    const outcome = await withProviderAuth(
      opts.preset,
      opts.entry,
      async (auth) => {
        try {
          const model = boundModel(opts, forceAnswer ? [] : tools, auth.token, auth.fetch as typeof fetch | undefined, signal);
          const loop = toLcMessages(messages);
          const payload: BaseMessage[] = system ? [new SystemMessage(system), ...loop] : loop;
          if (nudge) payload.push(new SystemMessage(nudge));
          const response = (await model.invoke(payload, { signal })) as AIMessage;
          return { kind: "response" as const, response };
        } catch (error) {
          return {
            kind: "error" as const,
            status: httpStatusOfError(error),
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      (result) => result.kind === "error" && result.status === 401,
    );
    if (!outcome.ok) return fail(outcome.error);
    if (outcome.value.kind === "error") {
      return fail(outcome.value.status ? `HTTP ${outcome.value.status}: ${outcome.value.message.slice(0, 1000)}` : outcome.value.message);
    }

    const response = outcome.value.response;
    accumulateUsage(response, usage);
    const text = textOfResponse(response);
    const toolCalls = toolCallsOfResponse(response, round);
    if (!toolCalls.length) {
      await trace(`# раунд ${round}: финальный ответ (${text.length} симв.)`);
      return { ok: true, text, usage, transcriptFile };
    }
    if (usage.toolCalls >= MAX_TOOL_CALLS) {
      return fail(`потолок вызовов инструментов исчерпан (${MAX_TOOL_CALLS})`);
    }

    messages.push({ role: "assistant", text, toolCalls });
    await trace(`# раунд ${round}: вызовы инструментов ${toolCalls.map((call) => call.name).join(", ")}`);
    for (const call of toolCalls) {
      if (usage.toolCalls >= MAX_TOOL_CALLS) break;
      const result = await dispatchTool({ ctx, call, callMcp: opts.callMcp });
      usage.toolCalls += 1;
      const event: ToolCallEvent = {
        tool: call.name,
        args: call.rawArgs.slice(0, 2000),
        ok: result.ok,
        blocked: result.blocked,
        outputSize: Buffer.byteLength(result.output, "utf8"),
        error: result.ok ? undefined : result.output.slice(0, 500),
        durationMs: result.durationMs,
      };
      opts.onToolCall?.(event);
      const contextOutput = result.output.length > MAX_TOOL_OUTPUT_CHARS
        ? result.output.slice(0, MAX_TOOL_OUTPUT_CHARS) + `\n[вывод обрезан: ${result.output.length} символов всего]`
        : result.output;
      await trace(`## ${call.name} ${call.rawArgs.slice(0, 500)} -> ${result.ok ? "ok" : result.blocked ? "blocked" : "error"}, ${event.outputSize} B, ${result.durationMs} ms\n${result.output}`);
      messages.push({ role: "tool", call, text: contextOutput });
    }
  }
  return fail(`лимит раундов цикла исчерпан (${maxRounds}) без финального ответа`);
}

/** Идентификатор расхода попытки цикла: детерминирован на прогон-шаг-секцию-попытку. */
export function loopReceiptId(parts: Array<string | number>): string {
  return "loop-" + createHash("sha256").update(parts.map(String).join("|")).digest("hex").slice(0, 24);
}
