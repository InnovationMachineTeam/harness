import { spawnSync } from "node:child_process";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { createLlmGuard, defaultRegistry, withLlmGuard, type SessionRegistry } from "@harness/guardrails";
import type { ProviderEntry, ProviderPreset } from "../providers";

/**
 * Фабрика LangChain-моделей по kind пресета провайдера. Единая точка сборки
 * для direct-чата (LangGraph) и агентного цикла workflow: openai -
 * ChatOpenAI с базовым URL из записи (покрывает Ollama, vLLM, LM Studio и
 * другие OpenAI-совместимые сервисы), anthropic - ChatAnthropic, gemini -
 * ChatGoogleGenerativeAI.
 *
 * Каждая модель обёрнута Guardrails: инъекции инструкций в промпте
 * блокируются, персональные данные и секреты редактируются в промпте и
 * в ответе до передачи дальше по цепочке. Для ASR-прогона и судьи
 * доступна сырая фабрика chatModelRawForProvider без обёртки.
 */

/** Guard по умолчанию: общий реестр значений сессии на процесс консоли. */
const guard = createLlmGuard();

const IDENTITY_REFRESH_MS = 60 * 60 * 1000;
let identityLearnedAt = 0;

/** Локальная идентичность пользователя из git config репозитория. */
export function readGitIdentity(cwd = process.cwd()): { name?: string; email?: string } {
  const read = (key: string): string | undefined => {
    const proc = spawnSync("git", ["config", "--get", key], { cwd, encoding: "utf8" });
    return proc.status === 0 && proc.stdout.trim() ? proc.stdout.trim() : undefined;
  };
  return { name: read("user.name"), email: read("user.email") };
}

/** Кладёт идентичность в реестр; значения редактируются в промптах и ответах. */
export function learnValues(registry: SessionRegistry, identity: { name?: string; email?: string }): void {
  if (identity.name) registry.learn("name", identity.name);
  if (identity.email) registry.learn("email", identity.email);
}

/** Наполняет общий реестр идентичностью пользователя; не чаще раза в час. */
export function learnIdentity(now = Date.now()): void {
  if (now - identityLearnedAt < IDENTITY_REFRESH_MS) return;
  identityLearnedAt = now;
  learnValues(defaultRegistry, readGitIdentity());
}

/** Таймаут одного запроса к провайдеру (как в core/providerRun.ts). */
/** Таймаут одного запроса к модели: reasoning-модели cloud на больших промтах идут дольше 5 минут. */
export const CHAT_REQUEST_TIMEOUT_MS = 900_000;

export type ChatEffort = "low" | "medium" | "high" | "max";

export interface ChatModelOptions {
  preset: ProviderPreset;
  entry: ProviderEntry;
  /** Модель tier из записи провайдера. */
  model: string;
  /** Токен провайдера (resolveProviderToken); локальным сервисам допустима пустая строка. */
  token: string;
  /** fetch с CA-сертификатом провайдера; без сертификата - глобальный fetch. */
  fetchImpl?: typeof fetch;
  /** Reasoning effort; передаётся только онлайн openai-совместимым провайдерам. */
  effort?: ChatEffort;
}

/** effort в терминах провайдера: max -> high; не openai-совместимым - undefined. */
export function effortForModel(preset: ProviderPreset, effort: ChatEffort | undefined): string | undefined {
  if (!effort || preset.kind !== "online" || preset.verify.kind !== "openai") return undefined;
  return effort === "max" ? "high" : effort;
}

export function chatModelRawForProvider(opts: ChatModelOptions): BaseChatModel {
  const base = opts.entry.baseUrl.trim().replace(/\/+$/, "");
  if (opts.preset.verify.kind === "anthropic") {
    return new ChatAnthropic({
      model: opts.model,
      anthropicApiKey: opts.token,
      maxTokens: 8192,
      maxRetries: 1,
      // SDK добавляет /v1/messages сам - суффикс /v1 из пресета снимается
      clientOptions: { baseURL: base.replace(/\/v1$/, ""), fetch: opts.fetchImpl, timeout: CHAT_REQUEST_TIMEOUT_MS },
    });
  }
  if (opts.preset.verify.kind === "gemini") {
    return new ChatGoogleGenerativeAI({
      model: opts.model,
      apiKey: opts.token,
      maxRetries: 1,
      // SDK дописывает версию API сам - суффикс /v1beta из пресета снимается
      baseUrl: base.replace(/\/v1beta$/, ""),
    });
  }
  const effort = effortForModel(opts.preset, opts.effort);
  return new ChatOpenAI({
    model: opts.model,
    apiKey: opts.token || "not-required",
    timeout: CHAT_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    configuration: { baseURL: base, fetch: opts.fetchImpl },
    ...(effort ? { modelKwargs: { reasoning_effort: effort } } : {}),
  });
}

export function chatModelForProvider(opts: ChatModelOptions): BaseChatModel {
  learnIdentity();
  return withLlmGuard(chatModelRawForProvider(opts), guard);
}
