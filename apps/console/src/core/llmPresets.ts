/**
 * Пресеты LLM-провайдеров для инструментов (OpenWiki, Graphify).
 * Пресет задаёт: значение провайдера, переменную окружения для API-ключа
 * и нужен ли base URL (OpenAI-совместимые эндпоинты: Ollama, vLLM, …).
 * Источники: github.com/langchain-ai/openwiki (OPENWIKI_PROVIDER) и
 * graphify --help (--backend auto-detect from API keys).
 */

export interface LlmPreset {
  id: string;
  label: string;
  /** Значение provider (OPENWIKI_PROVIDER) / backend (--backend). */
  provider: string;
  /** Env-переменная для API-ключа; null - ключ не требуется. */
  apiKeyEnv: string | null;
  /** Требуется base URL (OpenAI-совместимый эндпоинт). */
  needsBaseUrl: boolean;
}

export const OPENWIKI_PRESETS: LlmPreset[] = [
  {
    id: "openai-compatible",
    label: "OpenAI-совместимый (Ollama, vLLM, …)",
    provider: "openai-compatible",
    apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    needsBaseUrl: true,
  },
  { id: "openai", label: "OpenAI", provider: "openai", apiKeyEnv: "OPENAI_API_KEY", needsBaseUrl: false },
  { id: "gemini", label: "Google Gemini", provider: "gemini", apiKeyEnv: "GEMINI_API_KEY", needsBaseUrl: false },
  { id: "claude", label: "Anthropic Claude", provider: "claude", apiKeyEnv: "ANTHROPIC_API_KEY", needsBaseUrl: false },
  { id: "kimi", label: "Moonshot Kimi", provider: "kimi", apiKeyEnv: "MOONSHOT_API_KEY", needsBaseUrl: false },
  { id: "deepseek", label: "DeepSeek", provider: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY", needsBaseUrl: false },
];

export const GRAPHIFY_PRESETS: LlmPreset[] = [
  { id: "auto", label: "Авто (по ключам в окружении)", provider: "", apiKeyEnv: null, needsBaseUrl: false },
  { id: "gemini", label: "Google Gemini", provider: "gemini", apiKeyEnv: "GEMINI_API_KEY", needsBaseUrl: false },
  { id: "claude-cli", label: "Claude Code (локальный CLI)", provider: "claude-cli", apiKeyEnv: null, needsBaseUrl: false },
  { id: "ollama", label: "Ollama (локальный)", provider: "ollama", apiKeyEnv: "OLLAMA_API_KEY", needsBaseUrl: false },
  { id: "openai", label: "OpenAI", provider: "openai", apiKeyEnv: "OPENAI_API_KEY", needsBaseUrl: false },
  { id: "anthropic", label: "Anthropic", provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", needsBaseUrl: false },
  { id: "deepseek", label: "DeepSeek", provider: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY", needsBaseUrl: false },
  { id: "kimi", label: "Moonshot Kimi", provider: "kimi", apiKeyEnv: "MOONSHOT_API_KEY", needsBaseUrl: false },
];

export function presetById(list: LlmPreset[], id: string): LlmPreset | undefined {
  return list.find((p) => p.id === id);
}
