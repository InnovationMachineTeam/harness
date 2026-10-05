import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GuardBlockedError, classifierGate } from "@harness/guardrails";
import { getChatClassifier } from "@/core/llmClassifier";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { HumanMessage } from "@langchain/core/messages";
import { BUILTIN_TOOL_SPECS, enabledMcpServers } from "@/core/agentTools";
import { builtinLoopTools, type LoopTool } from "@/core/agentLoop";
import { buildProviderChatGraph, buildRuntimeChatGraph, CHAT_MAX_MODEL_STEPS, historyToLcMessages } from "@/core/agent/chatGraph";
import { providerChatUIMessages, runtimeChatUIMessages, type ChatStreamUsage } from "@/core/agent/chatStream";
import {
  renderAgentsSection,
  renderFilesSection,
  renderHarnessSkillsSection,
  renderSkillsSection,
  resolveFileRefs,
  resolvePromptCommands,
  runtimeExpandedPrompt,
  untrustedNotice,
} from "@/core/workflows/skills";
import { callMcpTool, listMcpTools } from "@/core/mcp/client";
import { createJsonRenderTransform } from "@json-render/core";
import {
  isActiveProvider,
  parseTaskProviderId,
  providerBaseUrlError,
  providerPresetById,
} from "@/core/providers";
import { readProviderEntry } from "@/core/providerSettings";
import { resolveProviderToken } from "@/core/providerAuth";
import { appendUsageRecords } from "@/core/providerUsage";
import { chatModelForProvider } from "@/core/langchain/chatModel";
import { launchPromptRun, runtimeModelForTier, type EffortLevel } from "@/core/prompts";
import { agentHistoryLimit, resolveDefaultProvider, workspaceDirs } from "@/core/state";
import { finishTaskMeta, saveTaskMeta, taskTitle } from "@/core/tasks";
import { serverContext } from "@/lib/server-context";
import { catalog } from "@/lib/json-render/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/agent/chat - единый стриминговый диалог вкладки "Агент".
 * Тело: {messages: UIMessage[], executor, tier, effort?, cwd?, branch?},
 * где executor - "<runtimeId>" или "provider:<id>" ("provider" - провайдер
 * по умолчанию). Ответ - UIMessage-стрим: текстовые части и data-spec части
 * json-render (преобразование createJsonRenderTransform выделяет спеку из
 * текста модели). Обе ветки исполняются как LangGraph-граф:
 * - Провайдер: граф "model"-"tools" (core/agent/chatGraph.ts), модель -
 *   LangChain (core/langchain/chatModel.ts) по kind пресета; effort -
 *   reasoning_effort онлайн openai-совместимым провайдерам.
 * - Рантайм: узел графа запускает headless-CLI (launchPromptRun,
 *   cwd/model/effort) и стримит хвост лог-файла, пока жив процесс.
 * Каждый запуск регистрируется в "Мониторинг → Задачи".
 */

const bodySchema = z.object({
  messages: z
    .array(
      z
        .object({
          role: z.enum(["system", "user", "assistant"]),
          parts: z.array(z.object({ type: z.string() }).loose()),
        })
        .loose(),
    )
    .min(1),
  executor: z.string().min(1),
  tier: z.enum(["fast", "standard", "strong", "subagents"]).default("standard"),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  cwd: z.string().optional(),
  branch: z.string().nullish(),
});

/** Дописать в лог запуска (для карточки задачи в мониторинге). */
async function appendRunLog(runsDir: string, logFile: string, text: string): Promise<void> {
  try {
    await mkdir(runsDir, { recursive: true });
    await appendFile(logFile, text, "utf8");
  } catch {
    /* лог не критичен для ответа */
  }
}

/** Асинхронный генератор -> ReadableStream (pull-режим, отмена через gen.return). */
function streamFromGenerator<T>(generator: AsyncGenerator<T>): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      const { value, done } = await generator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await generator.return(undefined).catch(() => undefined);
    },
  });
}

/** Прогнать чанки через createJsonRenderTransform: текст с ```spec-блоками
 * превращается в текстовые части + data-spec части json-render. */
function throughJsonRender(source: ReadableStream<object>): ReadableStream<unknown> {
  return source.pipeThrough(
    createJsonRenderTransform() as unknown as TransformStream<object, unknown>,
  );
}

/** Переписка UIMessage -> текст промта для headless-CLI (без state-частей). */
function historyToPrompt(messages: z.infer<typeof bodySchema>["messages"]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text?: string }).text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    lines.push(`${message.role === "user" ? "Пользователь" : "Ассистент"}: ${text}`);
  }
  let joined = lines.join("\n\n");
  // лимит argv (sanitizePromptArg - 32k): старые реплики обрезаются первыми
  while (joined.length > 28_000) {
    const cut = joined.indexOf("\n\n");
    if (cut < 0) {
      joined = joined.slice(-28_000);
      break;
    }
    joined = joined.slice(cut + 2);
  }
  return joined;
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const raw = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "неверное тело запроса: " + parsed.error.issues[0]?.message }, { status: 400 });
  }
  const body = parsed.data;
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const title = taskTitle(
    lastUser?.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text?: string }).text ?? "")
      .join(" ") ?? "диалог агента",
  );

  const cwd = body.cwd?.trim() || ctx.repoRoot;
  if (cwd !== ctx.repoRoot && !workspaceDirs(ctx.state).includes(cwd)) {
    return NextResponse.json({ error: "папка не входит в список рабочих папок" }, { status: 400 });
  }

  // Slash-команды последней реплики (/skill:<id>, /agent:<id>, @путь):
  // раскрытие выполняется на сервере, история хранит исходный текст с токенами.
  const lastUserText = lastUser?.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text?: string }).text ?? "")
    .join("\n")
    .trim() ?? "";
  // Второй слой Guardrails: модельный классификатор на входе direct-чата
  // (локальный ollama, fail-open; отключается GUARDRAILS_CLASSIFIER_DISABLED=1).
  if (lastUserText && (body.executor === "provider" || parseTaskProviderId(body.executor) !== null)) {
    try {
      await classifierGate(getChatClassifier(), lastUserText);
    } catch (error) {
      if (error instanceof GuardBlockedError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }
  const commands = lastUserText
    ? await resolvePromptCommands(ctx.repoRoot, { executor: body.executor, input: lastUserText, state: ctx.state }).catch(
        (error: unknown): NonNullable<Awaited<ReturnType<typeof resolvePromptCommands>>> => ({
          commands: { skillIds: [], autoSkill: false, agentIds: [], harnessIds: [], prompt: lastUserText },
          prompt: lastUserText,
          skills: [],
          harnessSkills: [],
          agents: [],
          errors: [error instanceof Error ? error.message : String(error)],
        }),
      )
    : null;
  if (commands?.errors.length) {
    return NextResponse.json({ error: commands.errors.join("; ") }, { status: 400 });
  }

  const runsDir = path.join(ctx.repoRoot, ".agents", "console", "runs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // в модель уходит только хвост истории: последние N реплик (Настройки → AI SDK); 0 - без ограничения
  const historyLimit = agentHistoryLimit(ctx.state);
  const modelMessages = historyLimit > 0 ? body.messages.slice(-historyLimit) : body.messages;

  /* ----------------------------- провайдер ----------------------------- */
  const providerId = body.executor === "provider" ? "provider" : parseTaskProviderId(body.executor);
  if (providerId !== null) {
    const resolvedId = providerId === "provider" ? resolveDefaultProvider(ctx.state) : providerId;
    const preset = providerPresetById(resolvedId);
    if (!preset) {
      return NextResponse.json({ error: `провайдер не найден в реестре: ${resolvedId}` }, { status: 400 });
    }
    const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[resolvedId] ?? null);
    if (!isActiveProvider(preset, entry)) {
      return NextResponse.json(
        { error: `провайдер ${preset.label} не активен - заполните поля и пройдите проверку на вкладке "Провайдеры"` },
        { status: 400 },
      );
    }
    // политика хоста: онлайн-провайдерам запрещены локальные и приватные адреса
    const baseUrlError = providerBaseUrlError(entry.baseUrl, preset.kind);
    if (baseUrlError) {
      return NextResponse.json({ error: baseUrlError }, { status: 400 });
    }
    const model = entry.models[body.tier].trim();
    if (!model) {
      return NextResponse.json({ error: `у провайдера не задана модель tier ${body.tier}` }, { status: 400 });
    }
    const auth = await resolveProviderToken(preset, entry);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 400 });
    }

    const logFile = path.join(runsDir, `${stamp}-agent-provider-${resolvedId}.log`);
    const taskId = await saveTaskMeta(ctx.repoRoot, {
      kind: "prompt",
      title,
      executor: { type: "provider", id: resolvedId },
      model,
      pid: null,
      sessionRuntime: null,
      logFile,
      detail: `${cwd}${body.branch ? `, ветка ${body.branch}` : ""}, effort ${body.effort ?? "default"}`,
    }).catch(() => "");

    const effort: EffortLevel | undefined = body.effort;
    const contextLines = [
      "Ты ассистент консоли harness. Отвечай по-русски, деловым стилем, кратко.",
      `Твоя текущая модель: ${model} (провайдер ${resolvedId}).`,
      cwd === ctx.repoRoot
        ? `Рабочая папка пользователя: корень репозитория ${ctx.repoRoot}${body.branch ? ` (ветка ${body.branch})` : ""}.`
        : `Рабочая папка пользователя: ${cwd}${body.branch ? ` (ветка ${body.branch})` : ""}.`,
      "Если ответ выигрывает от структурированной подачи (сравнение, метрики, список шагов) - собери UI по правилам спеки ниже; иначе отвечай обычным текстом.",
    ];
    // Роль (/agent:), master-навыки (/master:) и harness-навыки (/имя) -
    // в системный промт провайдера.
    const commandSystem = [
      renderAgentsSection(commands?.agents ?? []),
      renderSkillsSection(commands?.skills ?? []),
      renderHarnessSkillsSection(commands?.harnessSkills ?? []),
    ].filter(Boolean).join("\n\n");

    // Файлы по токенам @путь разворачиваются в содержимое последней реплики.
    const providerPromptText = commands?.prompt || lastUserText;
    const fileRefs = await resolveFileRefs(providerPromptText, cwd);
    if (fileRefs.errors.length) {
      return NextResponse.json({ error: fileRefs.errors.join("; ") }, { status: 400 });
    }
    const finalUserText = [providerPromptText, renderFilesSection(fileRefs.files)].filter(Boolean).join("\n\n");
    const untrusted =
      commands?.skills.length || commands?.harnessSkills.length || commands?.agents.length || fileRefs.files.length
        ? untrustedNotice()
        : null;

    // Инструменты агентного цикла: вызовы исполняются исполнителем
    // core/agentTools.ts (изоляция рабочей папки, guard для run_command),
    // текст результата возвращается модели на следующем шаге. Дополнительно
    // подключаются инструменты включённых MCP-серверов реестра.
    const mcpServers = enabledMcpServers(ctx.state);
    const mcpGroups = mcpServers.length ? await listMcpTools({ cwd, servers: mcpServers }) : [];
    const mcpTools: LoopTool[] = mcpGroups.flatMap((group) =>
      group.tools.map((tool) => ({ name: tool.qualifiedName, description: tool.description, parameters: tool.parameters })),
    );
    const callMcp = mcpServers.length
      ? (qualifiedName: string, args: unknown) => callMcpTool({ cwd, servers: mcpServers, qualifiedName, args })
      : undefined;

    const graph = buildProviderChatGraph({
      model: chatModelForProvider({
        preset,
        entry,
        model,
        token: auth.auth.token,
        fetchImpl: auth.auth.fetch as typeof fetch,
        effort,
      }),
      system: [contextLines.join("\n"), untrusted, commandSystem, catalog.prompt({ mode: "inline" })].filter(Boolean).join("\n\n"),
      tools: [...builtinLoopTools(), ...mcpTools],
      ctx: { cwd, repoRoot: ctx.repoRoot },
      callMcp,
    });

    // Последняя user-реплика заменяется на раскрытую (без токенов, с файлами);
    // предыдущая история остаётся без изменений.
    const lcMessages = historyToLcMessages(modelMessages);
    if (commands || fileRefs.files.length) {
      for (let index = lcMessages.length - 1; index >= 0; index -= 1) {
        if (lcMessages[index] instanceof HumanMessage) {
          lcMessages[index] = new HumanMessage(finalUserText || lastUserText);
          break;
        }
      }
    }

    const streamUsage: ChatStreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const events = (await graph.stream(
      { messages: lcMessages },
      { streamMode: ["messages", "updates"], signal: request.signal, recursionLimit: CHAT_MAX_MODEL_STEPS * 2 + 4 },
    )) as unknown as AsyncIterable<unknown>;
    const uiStream = throughJsonRender(
      streamFromGenerator(providerChatUIMessages(events, streamUsage)),
    );
    const stream = createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        let accumulated = "";
        try {
          for await (const chunk of uiStream) {
            if ((chunk as { type?: string }).type === "text-delta") {
              accumulated += (chunk as { delta?: string }).delta ?? "";
            }
            writer.write(chunk as Parameters<typeof writer.write>[0]);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await appendRunLog(runsDir, logFile, `ошибка стрима: ${message}\n`);
          await finishTaskMeta(ctx.repoRoot, taskId, "failed").catch(() => undefined);
          throw err;
        }
        await appendRunLog(runsDir, logFile, `${accumulated}\n`);
        await finishTaskMeta(ctx.repoRoot, taskId, "completed").catch(() => undefined);
        try {
          if (streamUsage.totalTokens > 0) {
            await appendUsageRecords(ctx.repoRoot, [
              {
                at: new Date().toISOString(),
                source: "agent-chat",
                provider: resolvedId,
                model,
                kind: "agent-chat",
                inputTokens: streamUsage.inputTokens,
                outputTokens: streamUsage.outputTokens,
                totalTokens: streamUsage.totalTokens,
              },
            ]).catch(() => undefined);
          }
        } catch {
          /* usage недоступен - статистика не критична */
        }
      },
      onError: (err) => (err instanceof Error ? err.message : String(err)),
    });
    return createUIMessageStreamResponse({ stream });
  }

  /* ------------------------------ рантайм ------------------------------ */
  const runtimeId = body.executor;
  const adapter = ctx.adapters[runtimeId];
  if (!adapter) {
    return NextResponse.json({ error: `неизвестный рантайм: ${runtimeId}` }, { status: 400 });
  }
  if (!adapter.runCommand) {
    return NextResponse.json({ error: `рантайм ${runtimeId} не поддерживает headless-запуск промтов (нет CLI)` }, { status: 400 });
  }
  const tierModel = await runtimeModelForTier(ctx.repoRoot, runtimeId, body.tier);
  const effort = body.effort ?? (tierModel?.thinkingLevel as EffortLevel | undefined) ?? undefined;
  // Последняя user-реплика заменяется раскрытым промтом (навыки, роль, промт);
  // токены @путь остаются без изменений - рантайм резолвит их нативно.
  const runtimeUserPrompt = commands ? runtimeExpandedPrompt(commands) : lastUserText;
  const priorMessages = commands
    ? modelMessages.filter((message, index) => index !== modelMessages.map((item) => item.role).lastIndexOf("user"))
    : modelMessages;
  // директива в конце: taskTitle берёт начало промта из истории реплик
  const prompt = [
    historyToPrompt(priorMessages),
    runtimeUserPrompt,
    "Инструкция: это прямой диалог консоли - отвечай сразу по существу вопроса; служебные проверки (настройки рантайма, статус инструментов) не выполняй, если пользователь не просит явно.",
  ].filter(Boolean).join("\n\n");
  // запуск headless-CLI выполняется внутри узла графа; ошибка запуска
  // уходит в стрим как error-часть (ответ уже начат)
  const graph = buildRuntimeChatGraph({
    launch: () =>
      launchPromptRun({
        repoRoot: ctx.repoRoot,
        adapter,
        runtimeId,
        prompt,
        cwd,
        model: tierModel?.model || undefined,
        effort,
        jsonStream: runtimeId === "codex",
      }),
  });
  const events = (await graph.stream({ messages: [] }, { streamMode: "custom" })) as unknown as AsyncIterable<unknown>;
  const uiStream = throughJsonRender(streamFromGenerator(runtimeChatUIMessages(events)));
  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      for await (const chunk of uiStream) {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      }
    },
    onError: (err) => (err instanceof Error ? err.message : String(err)),
  });
  return createUIMessageStreamResponse({ stream });
}
