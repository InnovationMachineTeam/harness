import type { ToolDef } from "../tools";

/**
 * Плагин инструмента LightRAG: графовый RAG-сервер (HKUDS, пакет
 * lightrag-hku[api], CLI lightrag-server). Хранилище графа - Neo4j
 * (env в core/lightragLlm.ts), REST API и WebUI - :9621. LLM-биндинг
 * настраивается в разделе "Знание → Связки" (state.lightragLlm); без
 * настроенного биндинга сервер не стартует. MCP-пресета нет - интеграция
 * через OpenAI-совместимый API сервера.
 */
export const lightragTool: ToolDef = {
  id: "lightrag",
  title: "LightRAG",
  description:
    "Графовый RAG-сервер: индексация документов и запросы по графу знаний; граф хранится в Neo4j, REST API и WebUI - на :9621 (только localhost). Для старта нужен LLM-биндинг - настраивается в разделе Знание → Связки.",
  docsUrl: "https://github.com/HKUDS/LightRAG",
  category: "memory",
  bin: "lightrag-server",
  // offline-llm - клиенты биндингов (ollama/openai/anthropic); offline-storage -
  // драйверы хранилищ (neo4j и др.); без них lightrag-server падает при старте
  systemInstall: () => ["uv", "tool", "install", "lightrag-hku[api,offline-llm,offline-storage]"],
  systemUpdate: () => ["uv", "tool", "upgrade", "lightrag-hku"],
  requires: {
    bin: "uv",
    installCommand: (platform) => (platform === "darwin" ? ["brew", "install", "uv"] : null),
  },
  dashboard: { url: "http://127.0.0.1:9621", label: "WebUI LightRAG" },
  uninstallStopsDashboard: true,
};
