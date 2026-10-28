import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { builtinLoopTools, type LoopTool } from "@/core/agentLoop";
import { enabledMcpServers } from "@/core/agentTools";
import { aguiMessageToUiMessage, uiChunksToAguiEvents, threadIdToChatId, type AguiUiMessage } from "@/core/agui/adapter";
import { buildProviderChatGraph, buildRuntimeChatGraph, CHAT_MAX_MODEL_STEPS, historyToLcMessages } from "@/core/agent/chatGraph";
import { providerChatUIMessages, runtimeChatUIMessages, type ChatStreamUsage, type UIChunk } from "@/core/agent/chatStream";
import { callMcpTool, listMcpTools } from "@/core/mcp/client";
import { isActiveProvider, parseTaskProviderId, providerBaseUrlError, providerPresetById } from "@/core/providers";
import { readProviderEntry } from "@/core/providerSettings";
import { resolveProviderToken } from "@/core/providerAuth";
import { launchPromptRun, runtimeModelForTier, type EffortLevel } from "@/core/prompts";
import { resolveDefaultProvider, resolveTaskRuntime, type ConsoleState } from "@/core/state";
import { finishTaskMeta, saveTaskMeta, taskTitle } from "@/core/tasks";
import { readDirectChat, saveDirectChat, type DirectChatMessage } from "@/core/directChats";
import { chatModelForProvider } from "@/core/langchain/chatModel";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/agui - endpoint протокола AG-UI 1.0 (HTTP SSE binding): внешний
 * клиент (CopilotKit OpenBot/OpenDuet/OpenMuse, bring-your-own-agent) передаёт
 * RunAgentInput {threadId, runId, messages, context}, получает text/event-stream
 * с событиями RUN_STARTED / TEXT_MESSAGE_* / TOOL_CALL_* / RUN_FINISHED|RUN_ERROR.
 * Исполнитель - рантайм Harness (headless-CLI) или провайдер реестра; выбор
 * передаётся в context.executor (по умолчанию - исполнитель промтов из настроек),
 * context.tier/context.effort уточняют модель. Авторизация: Bearer-токен из
 * state.agui (включается в "Настройки → Основные"); ошибки до старта стрима -
 * HTTP-коды. Ограничения v1: только серверные инструменты, нет resume,
 * cwd всегда корень репозитория.
 */

interface AguiRequestBody {
  threadId?: unknown;
  runId?: unknown;
  messages?: unknown;
  context?: { executor?: unknown; tier?: unknown; effort?: unknown } | unknown;
}

function tokenMatches(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resolveExecutor(state: ConsoleState, raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "provider" || /^provider:[a-z0-9][a-z0-9-]*$/.test(value) || /^[a-z0-9][a-z0-9-]*$/.test(value)) return value;
  return resolveTaskRuntime(state, "promptExecution") ?? `provider:${resolveDefaultProvider(state)}`;
}

function sseResponse(generator: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await generator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await generator.return(undefined).catch(() => undefined);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const ctx = await serverContext();

  if (!ctx.state.agui?.enabled || !ctx.state.agui.token) {
    return NextResponse.json({ error: "AG-UI endpoint выключен; включите в Настройки → Основные" }, { status: 403 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!tokenMatches(ctx.state.agui.token, auth.startsWith("Bearer ") ? auth.slice(7) : "")) {
    return NextResponse.json({ error: "неверный Bearer-токен" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as AguiRequestBody | null;
  const threadId = typeof body?.threadId === "string" && body.threadId.trim() ? body.threadId.trim().slice(0, 200) : "";
  if (!threadId) return NextResponse.json({ error: "threadId обязателен" }, { status: 400 });
  const runId = typeof body?.runId === "string" && body.runId.trim() ? body.runId.trim().slice(0, 200) : `run-${Date.now()}`;
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages обязателен (массив сообщений)" }, { status: 400 });
  }
  const uiMessages: AguiUiMessage[] = [];
  for (const raw of body.messages) {
    const converted = aguiMessageToUiMessage((raw ?? {}) as { role?: unknown; content?: unknown });
    if (converted) uiMessages.push(converted);
  }
  if (!uiMessages.some((message) => message.role === "user")) {
    return NextResponse.json({ error: "в messages нет реплики пользователя" }, { status: 400 });
  }
  const context = (body?.context ?? {}) as { executor?: unknown; tier?: unknown; effort?: unknown };
  const executor = resolveExecutor(ctx.state, context.executor);
  const tier = ["fast", "standard", "strong", "subagents"].includes(String(context.tier)) ? String(context.tier) as "fast" | "standard" | "strong" | "subagents" : "standard";
  const effortRaw = String(context.effort ?? "");
  const effort: EffortLevel | undefined = ["low", "medium", "high", "max"].includes(effortRaw) ? effortRaw as EffortLevel : undefined;

  const lastUserText = [...uiMessages].reverse().find((message) => message.role === "user")?.parts
    .map((part) => String((part as { text?: string }).text ?? ""))
    .join("\n") ?? "";
  const runsDir = path.join(ctx.repoRoot, ".agents", "console", "runs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const chatId = threadIdToChatId(threadId);

  /* ----------------------------- провайдер ----------------------------- */
  const providerId = executor === "provider" ? resolveDefaultProvider(ctx.state) : parseTaskProviderId(executor);
  if (providerId !== null) {
    const preset = providerPresetById(providerId);
    if (!preset) return NextResponse.json({ error: `провайдер не найден в реестре: ${providerId}` }, { status: 400 });
    const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[providerId] ?? null);
    if (!entry || !isActiveProvider(preset, entry)) {
      return NextResponse.json({ error: `провайдер ${providerId} не активен` }, { status: 400 });
    }
    const baseUrlError = providerBaseUrlError(entry.baseUrl, preset.kind);
    if (baseUrlError) return NextResponse.json({ error: baseUrlError }, { status: 400 });
    const model = entry.models[tier].trim();
    if (!model) return NextResponse.json({ error: `у провайдера ${providerId} не задана модель tier ${tier}` }, { status: 400 });
    const auth = await resolveProviderToken(preset, entry);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 400 });

    const logFile = path.join(runsDir, `${stamp}-agui-${providerId}.log`);
    const taskId = await saveTaskMeta(ctx.repoRoot, {
      kind: "prompt",
      title: `AG-UI: ${taskTitle(lastUserText)}`,
      executor: { type: "provider", id: providerId },
      model,
      pid: null,
      sessionRuntime: null,
      logFile,
      detail: `AG-UI thread ${threadId}`,
    }).catch(() => null);

    const mcpServers = enabledMcpServers(ctx.state);
    const mcpGroups = mcpServers.length ? await listMcpTools({ cwd: ctx.repoRoot, servers: mcpServers }).catch(() => []) : [];
    const mcpTools: LoopTool[] = mcpGroups.flatMap((group) =>
      group.tools.map((tool) => ({ name: tool.qualifiedName, description: tool.description, parameters: tool.parameters })),
    );
    const graph = buildProviderChatGraph({
      model: chatModelForProvider({ preset, entry, model, token: auth.auth.token, fetchImpl: auth.auth.fetch as typeof fetch, effort }),
      system: `Ты агент Harness, подключённый из внешнего приложения по протоколу AG-UI. Отвечай по существу. Рабочая папка: ${ctx.repoRoot}. Соблюдай политику репозитория.`,
      tools: [...builtinLoopTools(), ...mcpTools],
      ctx: { cwd: ctx.repoRoot, repoRoot: ctx.repoRoot },
      callMcp: mcpServers.length
        ? (qualifiedName, args) => callMcpTool({ cwd: ctx.repoRoot, servers: mcpServers, qualifiedName, args })
        : undefined,
    });
    const usage: ChatStreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const events = (await graph.stream(
      { messages: historyToLcMessages(uiMessages) },
      { streamMode: ["messages", "updates"], signal: request.signal, recursionLimit: CHAT_MAX_MODEL_STEPS * 2 + 4 },
    )) as unknown as AsyncIterable<unknown>;

    async function* sse(): AsyncGenerator<string> {
      let answer = "";
      const chunks: AsyncGenerator<UIChunk> = providerChatUIMessages(events, usage);
      try {
        for await (const frame of uiChunksToAguiEvents(chunks, { threadId, runId })) {
          if (frame.type === "TEXT_MESSAGE_CONTENT") answer += String(frame.delta ?? "");
          yield `data: ${JSON.stringify(frame)}\n\n`;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield `data: ${JSON.stringify({ type: "RUN_ERROR", message })}\n\n`;
      }
      if (taskId) await finishTaskMeta(ctx.repoRoot, taskId, "completed").catch(() => undefined);
      await persistChat(ctx.repoRoot, chatId, uiMessages, answer);
    }
    return sseResponse(sse());
  }

  /* ------------------------------ рантайм ------------------------------ */
  const adapter = ctx.adapters[executor];
  if (!adapter || !adapter.runCommand) {
    return NextResponse.json({ error: `рантайм не поддерживает headless-запуск: ${executor}` }, { status: 400 });
  }
  const tierModel = await runtimeModelForTier(ctx.repoRoot, executor, tier);
  const runtimeEffort = effort ?? (tierModel?.thinkingLevel as EffortLevel | undefined) ?? undefined;
  const prompt = [
    ...uiMessages.map((message) => `${message.role === "user" ? "Пользователь" : "Ассистент"}: ${message.parts.map((part) => String((part as { text?: string }).text ?? "")).join("\n")}`),
    "Инструкция: это диалог через AG-UI endpoint консоли - отвечай сразу по существу вопроса.",
  ].join("\n\n").slice(0, 28_000);
  const graph = buildRuntimeChatGraph({
    launch: () => launchPromptRun({
      repoRoot: ctx.repoRoot,
      adapter,
      runtimeId: executor,
      prompt,
      cwd: ctx.repoRoot,
      model: tierModel?.model || undefined,
      effort: runtimeEffort,
      jsonStream: executor === "codex",
    }),
  });
  const events = (await graph.stream({ messages: [] }, { streamMode: "custom" })) as unknown as AsyncIterable<unknown>;

  async function* sse(): AsyncGenerator<string> {
    let answer = "";
    const chunks = runtimeChatUIMessages(events);
    try {
      for await (const frame of uiChunksToAguiEvents(chunks, { threadId, runId })) {
        if (frame.type === "TEXT_MESSAGE_CONTENT") answer += String(frame.delta ?? "");
        yield `data: ${JSON.stringify(frame)}\n\n`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield `data: ${JSON.stringify({ type: "RUN_ERROR", message })}\n\n`;
    }
    await persistChat(ctx.repoRoot, chatId, uiMessages, answer);
  }
  return sseResponse(sse());
}

/** История AG-UI-треда дописывается в direct-чат: видна в списке чатов вкладки "Агент". */
async function persistChat(repoRoot: string, chatId: string, incoming: AguiUiMessage[], answer: string): Promise<void> {
  try {
    const existing = await readDirectChat(repoRoot, chatId);
    const messages = [...(existing?.messages ?? []), ...incoming];
    if (answer.trim()) messages.push({ id: `agui-${Date.now()}`, role: "assistant", parts: [{ type: "text", text: answer }] });
    await saveDirectChat(repoRoot, { id: chatId, messages });
  } catch {
    /* история не критична для ответа */
  }
}
