import { OPENWIKI_PRESETS, GRAPHIFY_PRESETS, presetById } from "./llmPresets";
import type { ConsoleState } from "./state";

/**
 * Env-маппинг LLM-провайдеров инструментов: значения из state
 * (пресет + ключ/model) превращаются в переменные окружения CLI.
 * Пресеты - core/llmPresets.ts (по докам OpenWiki и graphify --help).
 */

export interface OpenWikiLlmConfig {
  preset: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  /** Провайдер реестра, из которого выведены поля; undefined - ручная настройка. */
  providerId?: string;
}

export interface GraphifyLlmConfig {
  preset: string;
  apiKey: string;
  /** Модель для `--model` (пусто - значение по умолчанию CLI). */
  modelId: string;
  /** Провайдер реестра, из которого выведены поля; undefined - ручная настройка. */
  providerId?: string;
}

/** Конфиг OpenWiki из состояния (по умолчанию - локальный Ollama). */
export function openwikiLlmConfig(state: ConsoleState): OpenWikiLlmConfig {
  const cfg = state.openwikiLlm ?? {};
  return {
    preset: cfg.preset?.trim() || "openai-compatible",
    apiKey: cfg.apiKey?.trim() || "ollama",
    baseUrl: cfg.baseUrl?.trim() || "http://localhost:11434/v1",
    modelId: cfg.modelId?.trim() || "",
    providerId: cfg.providerId?.trim() || undefined,
  };
}

/** Конфиг Graphify из состояния (по умолчанию - авто-детект по окружению). */
export function graphifyLlmConfig(state: ConsoleState): GraphifyLlmConfig {
  const cfg = state.graphifyLlm ?? {};
  return {
    preset: cfg.preset?.trim() || "auto",
    apiKey: cfg.apiKey?.trim() || "",
    modelId: cfg.modelId?.trim() || "",
    providerId: cfg.providerId?.trim() || undefined,
  };
}

/** Env-переменные для openwiki CLI (по пресету; только непустые значения). */
export function openwikiLlmEnv(cfg: OpenWikiLlmConfig): Record<string, string> {
  const preset = presetById(OPENWIKI_PRESETS, cfg.preset) ?? OPENWIKI_PRESETS[0];
  const env: Record<string, string> = { OPENWIKI_PROVIDER: preset.provider };
  if (preset.apiKeyEnv && cfg.apiKey) env[preset.apiKeyEnv] = cfg.apiKey;
  if (preset.needsBaseUrl && cfg.baseUrl) env.OPENAI_COMPATIBLE_BASE_URL = cfg.baseUrl;
  if (cfg.modelId) env.OPENWIKI_MODEL_ID = cfg.modelId;
  return env;
}

/** Строка-префикс для runtime-промпта (агент экспортирует перед командой). */
export function openwikiLlmEnvPrefix(cfg: Required<OpenWikiLlmConfig>): string {
  return Object.entries(openwikiLlmEnv(cfg))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/** Env-переменные для graphify CLI (ключ пресета; пустой ключ - не передаётся). */
export function graphifyLlmEnv(cfg: GraphifyLlmConfig): Record<string, string> {
  const preset = presetById(GRAPHIFY_PRESETS, cfg.preset);
  if (!preset || !preset.apiKeyEnv || !cfg.apiKey) return {};
  return { [preset.apiKeyEnv]: cfg.apiKey };
}

/** Бэкенды `graphify extract --backend` (по graphify --help). */
const GRAPHIFY_EXTRACT_BACKENDS = new Set(["gemini", "kimi", "claude", "openai", "deepseek", "ollama"]);

/**
 * Значение `--backend` для extract: auto-детект CLI не видит ключ OLLAMA_API_KEY
 * и пресеты без ключа; для doc-корпуса бэкенд задаётся явно. Пресеты вне списка
 * extract (claude-cli - только для name/label) возвращают null.
 */
export function graphifyBackendArg(cfg: GraphifyLlmConfig): string | null {
  const preset = presetById(GRAPHIFY_PRESETS, cfg.preset);
  if (!preset || !GRAPHIFY_EXTRACT_BACKENDS.has(preset.provider)) return null;
  return preset.provider;
}
