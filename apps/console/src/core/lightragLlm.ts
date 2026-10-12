import { NEO4J_LOCAL_PASSWORD } from "./tools/neo4j";
import { LIGHTRAG_PRESETS, presetById } from "./llmPresets";
import type { ConsoleState } from "./state";

/**
 * LLM-биндинг и хранилище LightRAG: значения из state превращаются в
 * env-переменные lightrag-server (ядро lightrag-hku 1.5.7). Граф всегда
 * хранится в локальном Neo4j (LIGHTRAG_GRAPH_STORAGE=Neo4JStorage); KV,
 * векторы и статус документов - файлы рабочего каталога сервиса.
 * Пресеты - core/llmPresets.ts (LIGHTRAG_PRESETS).
 */

export interface LightragLlmConfig {
  preset: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  /** Провайдер реестра, из которого выведены поля; undefined - ручная настройка. */
  providerId?: string;
}

/** Конфиг LightRAG из состояния (по умолчанию - локальный Ollama). */
export function lightragLlmConfig(state: ConsoleState): LightragLlmConfig {
  const cfg = state.lightragLlm ?? {};
  return {
    preset: cfg.preset?.trim() || "ollama",
    apiKey: cfg.apiKey?.trim() || "ollama",
    baseUrl: cfg.baseUrl?.trim() || "http://localhost:11434",
    modelId: cfg.modelId?.trim() || "",
    providerId: cfg.providerId?.trim() || undefined,
  };
}

/** Env-переменные LLM/эмбеддинг-биндинга lightrag-server (только непустые). */
export function lightragLlmEnv(cfg: LightragLlmConfig): Record<string, string> {
  const preset = presetById(LIGHTRAG_PRESETS, cfg.preset) ?? LIGHTRAG_PRESETS[0];
  const env: Record<string, string> = { LLM_BINDING: preset.provider, EMBEDDING_BINDING: preset.provider };
  if (preset.needsBaseUrl) {
    env.LLM_BINDING_HOST = cfg.baseUrl;
    env.EMBEDDING_BINDING_HOST = cfg.baseUrl;
  }
  if (preset.apiKeyEnv) {
    env.LLM_BINDING_API_KEY = cfg.apiKey;
    env.EMBEDDING_BINDING_API_KEY = cfg.apiKey;
  }
  if (cfg.modelId) env.LLM_MODEL = cfg.modelId;
  return env;
}

/** Env-переменные хранилища графа LightRAG - локальный Neo4j (связка). */
export function lightragNeo4jEnv(): Record<string, string> {
  return {
    LIGHTRAG_GRAPH_STORAGE: "Neo4JStorage",
    NEO4J_URI: "bolt://localhost:7687",
    NEO4J_USERNAME: "neo4j",
    NEO4J_PASSWORD: NEO4J_LOCAL_PASSWORD,
  };
}

/** Полный env lightrag-server, управляемого консолью (LLM + хранилище). */
export function lightragServiceEnv(state: ConsoleState): Record<string, string> {
  return { ...lightragLlmEnv(lightragLlmConfig(state)), ...lightragNeo4jEnv() };
}

/**
 * Дополнительный env автономного сервиса инструмента при старте консолью
 * (startDashboard): пока только lightrag - LLM-биндинг и Neo4j-хранилище.
 * Общая точка для всех мест старта (action, autostart, dashboard).
 */
export function serviceExtraEnv(toolId: string, state: ConsoleState): Record<string, string> | undefined {
  return toolId === "lightrag" ? lightragServiceEnv(state) : undefined;
}
