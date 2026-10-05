/**
 * Реестр LLM-провайдеров консоли: пресеты (онлайн и локальные), модельные
 * tiers (как у рантаймов), вычисление статуса заполнения и проверка соединения.
 * Модуль изоморфный: используется и на клиенте (карточки провайдеров), и на
 * сервере (API /api/providers). Запуск промтов через провайдера - core/providerRun.ts.
 */

/* --------------------------------- типы --------------------------------- */

/** Modeltiers - те же роли, что в конфигах рантаймов (.agents/runtime). */
export type ModelTier = "fast" | "standard" | "strong" | "subagents";

export const MODEL_TIERS: readonly ModelTier[] = ["fast", "standard", "strong", "subagents"];

/** Провайдер AI SDK по умолчанию, пока пользователь не выбрал свой (★ в "Провайдерах"). */
export const FALLBACK_PROVIDER_ID = "ollama";

export const TIER_LABELS: Record<ModelTier, string> = {
  fast: "fast",
  standard: "standard",
  strong: "strong",
  subagents: "subagents",
};

/** Механизм проверки соединения и разбора ответа. */
export type VerifyKind = "openai" | "anthropic" | "gemini";

/**
 * fetch-совместимый транспорт: глобальный fetch или providerFetch
 * (core/providerHttp.ts). Отдельный тип - реализации Bun расширяют typeof fetch
 * дополнительными свойствами, из-за чего прямое присваивание не проходит.
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Схема авторизации с обменом ключа на короткоживущий access-токен.
 * Ключ из карточки (Basic) обменивается в tokenUrl; ответ - access-токен,
 * который передаётся в запросах к API как Bearer. Обмен и кеш - core/providerAuth.ts.
 */
export interface ProviderAuthScheme {
  kind: "oauth2";
  /** Точка обмена ключа на access-токен (POST, Basic-авторизация ключом). */
  tokenUrl: string;
  /** Scope по умолчанию; запись провайдера может переопределить (entry.authScope). */
  scopeDefault: string;
  /** Допустимые значения scope - выбор в карточке провайдера. */
  scopeOptions: string[];
  /** Подсказка в карточке о том, что вставлять в поле ключа. */
  hint?: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  /** Онлайн (внешний API) или локальный (на машине пользователя). */
  kind: "online" | "local";
  /** Env-переменная для API-ключа; null - ключ не требуется. */
  apiKeyEnv: string | null;
  /** Базовый URL OpenAI-совместимого (или родного) API; редактируется. */
  baseUrl: string;
  /**
   * Схема авторизации. Отсутствие - статический ключ (Bearer, как у большинства
   * OpenAI-совместимых API). "oauth2" - ключ требует обмена на access-токен.
   */
  auth?: ProviderAuthScheme;
  verify: {
    kind: VerifyKind;
    /** Проверочный запрос: GET {baseUrl}/models, /v1/models, ... по kind. */
  };
  /** Модели по умолчанию по tiers - пресет устанавливает их, как у рантаймов. */
  models: Record<ModelTier, string>;
  /** Документация провайдера. */
  docsUrl?: string;
  /**
   * Локальный сервис: чем проверяется установка (бинарники в PATH и
   * дополнительные пути) - core/providerLocal.ts. Только для kind: "local".
   */
  local?: { binaries: string[]; extraPaths?: string[] };
  /**
   * Сертификат CA: загружается файлом в карточке и хранится под стандартным
   * именем ca.pem в папке провайдера (.agents/providers/<id>/, вне git).
   * required - API недоступен без сертификата (GigaChat: цепочка НУЦ).
   */
  cert?: { required: boolean; hint?: string };
  /**
   * Маппинг на пресеты инструментов: id в OPENWIKI_PRESETS / GRAPHIFY_PRESETS
   * (core/llmPresets.ts). Отсутствие - провайдер для инструмента не предлагается.
   */
  tools: { openwiki?: string; graphify?: string };
}

/** Запись провайдера в state.json (state.providers.entries[id]). */
export interface ProviderEntry {
  apiKey: string;
  baseUrl: string;
  models: Record<ModelTier, string>;
  /** Scope обмена токена; по умолчанию - scopeDefault пресета (для auth.kind = "oauth2"). */
  authScope?: string;
  /** Стандартный путь сертификата CA (.agents/providers/<id>/ca.pem); ставится сервером при наличии файла. */
  caFile?: string;
  /** Последняя успешная проверка; null - не проверен или изменился после проверки. */
  verifiedAt: string | null;
  /** Ошибка последней проверки; null - ошибки нет. */
  verifyError: string | null;
  /** Список моделей из проверочного ответа (подсказка для выбора). */
  verifyModels: string[];
}

/**
 * Результат проверки провайдера - машинное состояние в
 * .agents/console/state.json. Редактируемые значения (ключ, base URL,
 * модели, scope, сертификат) хранятся файлами в .agents/providers/<id>/
 * (core/providerSettings.ts); ProviderEntry - собранное представление
 * "файлы + результат проверки" для UI и запросов к API.
 */
export interface ProviderVerification {
  verifiedAt: string | null;
  verifyError: string | null;
  verifyModels: string[];
}

/** Состояние локального сервиса (вычисляется на сервере - core/providerLocal.ts). */
export interface LocalRuntimeState {
  installed: boolean;
  running: boolean;
}

/**
 * Статус провайдера:
 * - "not-installed" - локальный сервис не установлен (бинарник не найден);
 * - "not-running" - локальный сервис установлен, но не запущен;
 * - "empty" - не все поля заполнены (карточка выглядит отключенной);
 * - "filled" - заполнен, проверка не проводилась (доступна кнопка проверки);
 * - "error" - последняя проверка не пройдена;
 * - "active" - проверка пройдена. Активен только проверенный провайдер.
 */
export type ProviderStatus = "not-installed" | "not-running" | "empty" | "filled" | "error" | "active";

/** Провайдер в ответе GET /api/providers (пресет + запись + вычисленные поля). */
export interface ProviderDTO {
  id: string;
  label: string;
  kind: "online" | "local";
  apiKeyEnv: string | null;
  baseUrl: string;
  docsUrl?: string;
  /** Значения tiers из пресета (подсказка; у записи могут быть свои). */
  presetModels: Record<ModelTier, string>;
  /** Схема авторизации пресета; null - статический ключ. */
  auth: { kind: "oauth2"; scopeDefault: string; scopeOptions: string[]; hint?: string } | null;
  /** Сертификат CA загружен в папку провайдера (стандартное имя ca.pem). */
  certPresent: boolean;
  /** Сертификат обязателен для этого провайдера (без него API недоступен). */
  certRequired: boolean;
  /** Подсказка по сертификату пресета. */
  certHint?: string;
  /** Экспорт в LangGraph поддерживается (OAuth-ключ сторонний потребитель обменять не может). */
  langgraphSupported: boolean;
  /** Маппинг на пресеты инструментов (core/llmPresets.ts). */
  tools: { openwiki?: string; graphify?: string };
  entry: ProviderEntry | null;
  status: ProviderStatus;
  /** Состояние локального сервиса (только для kind: "local"). */
  local?: LocalRuntimeState;
  /** Интеграции: провайдер используется инструментом / экспортирован в LangGraph. */
  integrations: { openwiki: boolean; graphify: boolean; langgraph: boolean };
  /** Задачи консоли ("promptExecution", "skillCreation"), назначенные провайдеру. */
  tasks: string[];
  langgraphExportedAt: string | null;
}

/* -------------------------------- пресеты -------------------------------- */

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "online",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    verify: { kind: "openai" },
    models: { fast: "gpt-5-mini", standard: "gpt-5", strong: "gpt-5", subagents: "gpt-5-mini" },
    docsUrl: "https://platform.openai.com/docs",
    tools: { openwiki: "openai", graphify: "openai" },
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    kind: "online",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1",
    verify: { kind: "anthropic" },
    models: {
      fast: "claude-sonnet-5-5",
      standard: "claude-opus-5-5",
      strong: "claude-fable-5-1",
      subagents: "claude-sonnet-5-5",
    },
    docsUrl: "https://docs.anthropic.com",
    tools: { openwiki: "claude", graphify: "anthropic" },
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "online",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    verify: { kind: "gemini" },
    models: { fast: "gemini-3-flash", standard: "gemini-3-pro", strong: "gemini-3-pro", subagents: "gemini-3-flash" },
    docsUrl: "https://ai.google.dev/docs",
    tools: { openwiki: "gemini", graphify: "gemini" },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "online",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
    verify: { kind: "openai" },
    models: {
      fast: "deepseek-chat",
      standard: "deepseek-chat",
      strong: "deepseek-reasoner",
      subagents: "deepseek-chat",
    },
    docsUrl: "https://api-docs.deepseek.com",
    tools: { openwiki: "deepseek", graphify: "deepseek" },
  },
  {
    id: "kimi",
    label: "Moonshot Kimi",
    kind: "online",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseUrl: "https://api.moonshot.ai/v1",
    verify: { kind: "openai" },
    models: { fast: "kimi-k2.7-turbo", standard: "kimi-k3", strong: "kimi-k3", subagents: "kimi-k2.7-code" },
    docsUrl: "https://platform.moonshot.ai/docs",
    tools: { openwiki: "kimi", graphify: "kimi" },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "online",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    verify: { kind: "openai" },
    models: { fast: "openrouter/auto", standard: "openrouter/auto", strong: "openrouter/auto", subagents: "openrouter/auto" },
    docsUrl: "https://openrouter.ai/docs",
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "groq",
    label: "Groq",
    kind: "online",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    verify: { kind: "openai" },
    models: {
      fast: "llama-3.3-70b-versatile",
      standard: "llama-3.3-70b-versatile",
      strong: "deepseek-r1-distill-llama-70b",
      subagents: "llama-3.1-8b-instant",
    },
    docsUrl: "https://console.groq.com/docs",
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "xai",
    label: "xAI Grok",
    kind: "online",
    apiKeyEnv: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    verify: { kind: "openai" },
    models: { fast: "grok-4-fast", standard: "grok-4", strong: "grok-4", subagents: "grok-4-fast" },
    docsUrl: "https://docs.x.ai",
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "together",
    label: "Together AI",
    kind: "online",
    apiKeyEnv: "TOGETHER_API_KEY",
    baseUrl: "https://api.together.xyz/v1",
    verify: { kind: "openai" },
    models: {
      fast: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      standard: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      strong: "deepseek-ai/DeepSeek-V3",
      subagents: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    },
    docsUrl: "https://docs.together.ai",
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "mistral",
    label: "Mistral AI",
    kind: "online",
    apiKeyEnv: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    verify: { kind: "openai" },
    models: {
      fast: "mistral-small-latest",
      standard: "mistral-medium-latest",
      strong: "mistral-large-latest",
      subagents: "mistral-small-latest",
    },
    docsUrl: "https://docs.mistral.ai",
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "gigachat",
    label: "GigaChat (Сбер)",
    kind: "online",
    apiKeyEnv: "GIGACHAT_AUTH_KEY",
    baseUrl: "https://api.giga.chat/v1",
    auth: {
      kind: "oauth2",
      tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      scopeDefault: "GIGACHAT_API_PERS",
      scopeOptions: ["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"],
      hint: "вставьте ключ авторизации из личного кабинета - консоль сама обменяет его на access-токен",
    },
    verify: { kind: "openai" },
    models: {
      fast: "GigaChat-2-Lite",
      standard: "GigaChat-2-Pro",
      strong: "GigaChat-2-Max",
      subagents: "GigaChat-2-Lite",
    },
    cert: {
      required: true,
      hint: "корневой сертификат НУЦ Минцифры (gosuslugi.ru/ca), файл .pem или .crt",
    },
    docsUrl: "https://developers.sber.ru/docs/ru/gigachat/api/quickstart",
    tools: {},
  },
  {
    id: "yandexgpt",
    label: "YandexGPT (Yandex Cloud)",
    kind: "online",
    apiKeyEnv: "YANDEXGPT_API_KEY",
    baseUrl: "https://llm.api.cloud.yandex.net/v1",
    verify: { kind: "openai" },
    models: {
      fast: "yandexgpt-lite",
      standard: "yandexgpt",
      strong: "yandexgpt",
      subagents: "yandexgpt-lite",
    },
    cert: {
      required: false,
      hint: "не требуется; загрузите PEM при работе через корпоративный прокси",
    },
    docsUrl: "https://yandex.cloud/ru/docs/foundation-models/concepts",
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "ollama",
    label: "Ollama (локально)",
    kind: "local",
    apiKeyEnv: null,
    baseUrl: "http://localhost:11434/v1",
    verify: { kind: "openai" },
    models: { fast: "llama3.2:3b", standard: "qwen3:14b", strong: "qwen3:32b", subagents: "llama3.2:3b" },
    docsUrl: "https://ollama.com/docs",
    local: { binaries: ["ollama"], extraPaths: ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"] },
    tools: { openwiki: "openai-compatible", graphify: "ollama" },
  },
  {
    id: "lmstudio",
    label: "LM Studio (локально)",
    kind: "local",
    apiKeyEnv: null,
    baseUrl: "http://localhost:1234/v1",
    verify: { kind: "openai" },
    models: {
      fast: "qwen2.5-7b-instruct",
      standard: "qwen2.5-14b-instruct",
      strong: "qwen2.5-32b-instruct",
      subagents: "qwen2.5-7b-instruct",
    },
    docsUrl: "https://lmstudio.ai/docs",
    local: { binaries: ["lms"], extraPaths: ["/Applications/LM Studio.app", "/usr/local/bin/lms"] },
    tools: { openwiki: "openai-compatible" },
  },
  {
    id: "vllm",
    label: "vLLM (локально)",
    kind: "local",
    apiKeyEnv: null,
    baseUrl: "http://localhost:8000/v1",
    verify: { kind: "openai" },
    models: {
      fast: "Qwen/Qwen3-8B",
      standard: "Qwen/Qwen3-32B",
      strong: "Qwen/Qwen3-235B-A22B",
      subagents: "Qwen/Qwen3-8B",
    },
    docsUrl: "https://docs.vllm.ai",
    local: { binaries: ["vllm"], extraPaths: ["~/.local/bin/vllm", "/opt/homebrew/bin/vllm", "/usr/local/bin/vllm"] },
    tools: { openwiki: "openai-compatible" },
  },
];

export function providerPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/* ------------------------------ запись и статус ------------------------------ */

export function emptyProviderEntry(preset: ProviderPreset): ProviderEntry {
  return {
    apiKey: "",
    baseUrl: preset.baseUrl,
    models: { ...preset.models },
    authScope: preset.auth?.scopeDefault,
    caFile: "",
    verifiedAt: null,
    verifyError: null,
    verifyModels: [],
  };
}

/** Значение поля формы по умолчанию: сохранённая запись или значения пресета. */
export function formDefaults(preset: ProviderPreset, entry: ProviderEntry | null | undefined): ProviderEntry {
  return entry ?? emptyProviderEntry(preset);
}

function trimFields(entry: ProviderEntry): ProviderEntry {
  return {
    apiKey: entry.apiKey.trim(),
    baseUrl: entry.baseUrl.trim(),
    models: {
      fast: entry.models.fast.trim(),
      standard: entry.models.standard.trim(),
      strong: entry.models.strong.trim(),
      subagents: entry.models.subagents.trim(),
    },
    authScope: entry.authScope?.trim() || undefined,
    caFile: entry.caFile?.trim() || undefined,
    verifiedAt: entry.verifiedAt,
    verifyError: entry.verifyError,
    verifyModels: entry.verifyModels,
  };
}

/**
 * "Заполнены все поля": ключ (если требуется пресетом), base URL и все четыре
 * tiers моделей. Только у заполненного провайдера появляется кнопка проверки.
 */
export function providerComplete(preset: ProviderPreset, entry: ProviderEntry): boolean {
  const e = trimFields(entry);
  if (preset.apiKeyEnv && !e.apiKey) return false;
  if (!e.baseUrl) return false;
  return MODEL_TIERS.every((tier) => e.models[tier].length > 0);
}

/**
 * Статус провайдера с учётом состояния локального сервиса: для локальных
 * пресетов состояние runtime (установка/запуск) приоритетнее заполнения полей.
 */
export function providerStatus(
  preset: ProviderPreset,
  entry: ProviderEntry | null | undefined,
  local?: LocalRuntimeState,
): ProviderStatus {
  if (preset.local && local) {
    if (!local.installed) return "not-installed";
    if (!local.running) return "not-running";
  }
  if (!entry || !providerComplete(preset, entry)) return "empty";
  if (entry.verifiedAt) return "active";
  if (entry.verifyError) return "error";
  return "filled";
}

/**
 * Провайдер активен: проверка пройдена и ключ заполнен, если пресет его
 * требует. Провайдер без ключа (key.env пуст или отсутствует) - неактивен,
 * независимо от результата прошлой проверки.
 */
export function isActiveProvider(
  preset: { apiKeyEnv: string | null },
  entry: { verifiedAt: string | null; apiKey?: string } | null | undefined,
): boolean {
  if (!entry?.verifiedAt) return false;
  if (preset.apiKeyEnv && !entry.apiKey?.trim()) return false;
  return true;
}

/** Провайдер активен и пресет существует - условие выбора в задачах ("provider:<id>"). */
export function taskProviderId(id: string): string {
  return `provider:${id}`;
}

export function parseTaskProviderId(value: string): string | null {
  return value.startsWith("provider:") ? value.slice("provider:".length) : null;
}

/* ----------------------- интеграции и экспорт для LangGraph ----------------------- */

/**
 * Env-переменные для экспорта провайдера в LangGraph (.env-формат):
 * ключ под родной переменной пресета, base URL и модель по каждому tier.
 */
export function langgraphEnv(preset: ProviderPreset, entry: ProviderEntry): Array<[string, string]> {
  const e = trimFields(entry);
  const pairs: Array<[string, string]> = [["LANGGRAPH_PROVIDER", preset.id]];
  if (preset.apiKeyEnv && e.apiKey) pairs.push([preset.apiKeyEnv, e.apiKey]);
  if (preset.verify.kind === "openai" && preset.apiKeyEnv !== "OPENAI_API_KEY" && e.apiKey) {
    pairs.push(["OPENAI_API_KEY", e.apiKey]);
  }
  pairs.push(["OPENAI_BASE_URL", e.baseUrl]);
  for (const tier of MODEL_TIERS) pairs.push([`LANGGRAPH_MODEL_${tier.toUpperCase()}`, e.models[tier]]);
  return pairs;
}

export function langgraphEnvFile(preset: ProviderPreset, entry: ProviderEntry): string {
  return `${langgraphEnv(preset, entry)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
}

/**
 * Экспорт .env для LangGraph возможен только со статическим ключом: получатель
 * переменных не выполняет обмен OAuth, ключ oauth2-провайдера для него бесполезен.
 */
export function langgraphSupported(preset: ProviderPreset): boolean {
  return !preset.auth;
}

/* ------------------------------ валидация URL ------------------------------ */

/**
 * Проверка base URL провайдера: только http/https, без userinfo (user:pass@),
 * с ненулевым хостом. kind "online" дополнительно запрещает локальные и
 * приватные адреса (онлайн-провайдер не может указывать внутрь сети);
 * локальные пресеты (Ollama, LM Studio, vLLM) используют loopback-адреса -
 * они разрешены; запрещён облачный metadata-хост 169.254.169.254.
 * Возвращает null или текст ошибки.
 */
export function providerBaseUrlError(baseUrl: string, kind?: "online" | "local"): string | null {
  const value = baseUrl.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "base URL: невалидный URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "base URL: только протоколы http и https";
  }
  if (url.username || url.password) {
    return "base URL: userinfo (user:pass@) не поддерживается";
  }
  if (!url.hostname) {
    return "base URL: не указан хост";
  }
  if (url.hostname === "169.254.169.254") {
    return "base URL: облачный metadata-хост запрещён";
  }
  if (kind === "online") {
    const hostError = onlineHostError(url.hostname);
    if (hostError) return hostError;
  }
  return null;
}

/**
 * Локальные, приватные и зарезервированные адреса запрещены для онлайн-провайдера.
 * Проверка literal-хостов (имя и IP-литерал); DNS-резолв не выполняется.
 */
export function onlineHostError(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::" || host === "0.0.0.0") {
    return "base URL: локальные адреса запрещены для онлайн-провайдера";
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const localV4 =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224;
    if (localV4) {
      return "base URL: приватные и зарезервированные адреса запрещены для онлайн-провайдера";
    }
    return null;
  }
  if (host.includes(":")) {
    if (/^(fc|fd)/.test(host)) {
      return "base URL: приватные адреса (IPv6 ULA) запрещены для онлайн-провайдера";
    }
    if (/^fe[89ab]/.test(host)) {
      return "base URL: link-local адреса IPv6 запрещены для онлайн-провайдера";
    }
  }
  return null;
}

/* ------------------------------ проверка соединения ------------------------------ */

export interface VerifyResult {
  ok: boolean;
  error: string | null;
  /** Идентификаторы моделей из ответа (первые 20) - подсказка для tiers. */
  models: string[];
  /** HTTP-статус ответа при ошибке (для повтора после обновления OAuth-токена); null - сеть/парсинг. */
  httpStatus: number | null;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

/**
 * Проверка соединения: лёгкий GET списка моделей по kind пресета.
 * Успех - провайдер становится активным (verifiedAt); ошибка - текст в verifyError.
 * token - токен запросов (статический ключ или обменянный access-токен из
 * core/providerAuth.ts); по умолчанию - ключ записи.
 * fetchImpl - точка подмены в тестах.
 */
export async function verifyProvider(
  preset: ProviderPreset,
  entry: ProviderEntry,
  fetchImpl: FetchLike = fetch,
  token?: string,
): Promise<VerifyResult> {
  const e = trimFields(entry);
  const apiKey = token ?? e.apiKey;
  const baseUrlError = providerBaseUrlError(e.baseUrl, preset.kind);
  if (baseUrlError) {
    return { ok: false, error: baseUrlError, models: [], httpStatus: null };
  }
  const base = e.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = `${base}/models`;
  if (preset.verify.kind === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (preset.verify.kind === "gemini") {
    url = `${base}/models?key=${encodeURIComponent(apiKey)}`;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetchImpl(url, { headers, signal: timeoutSignal(10_000) });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, models: [], httpStatus: res.status };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "ответ не является JSON", models: [], httpStatus: res.status };
    }
    const ids = extractModelIds(json);
    if (ids === null) {
      return { ok: false, error: "неожиданный формат ответа - список моделей не найден", models: [], httpStatus: res.status };
    }
    return { ok: true, error: null, models: ids.slice(0, 20), httpStatus: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `соединение не удалось: ${message}`, models: [], httpStatus: null };
  }
}

/** Список моделей из ответа провайдера; null - формат не распознан. */
function extractModelIds(json: unknown): string[] | null {
  const fromList = (value: unknown, field: string): string[] | null => {
    if (!Array.isArray(value)) return null;
    const ids = value
      .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>)[field] : null))
      .filter((id): id is string => typeof id === "string");
    return value.length > 0 && ids.length === 0 ? null : ids;
  };
  const root = json as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return null;
  // OpenAI-совместимые и Anthropic: {data: [{id}]} / Gemini: {models: [{name}]}
  if (Array.isArray(root.data)) return fromList(root.data, "id");
  if (Array.isArray(root.models)) return fromList(root.models, "name");
  return null;
}
