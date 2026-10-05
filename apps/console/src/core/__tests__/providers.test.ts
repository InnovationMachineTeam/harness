import { describe, expect, test } from "bun:test";
import {
  emptyProviderEntry,
  isActiveProvider,
  langgraphEnvFile,
  langgraphSupported,
  MODEL_TIERS,
  onlineHostError,
  parseTaskProviderId,
  PROVIDER_PRESETS,
  providerBaseUrlError,
  providerComplete,
  providerPresetById,
  providerStatus,
  taskProviderId,
  verifyProvider,
  type ProviderEntry,
} from "@/core/providers";
import { defaultState } from "@/core/state";

const openai = providerPresetById("openai")!;
const ollama = providerPresetById("ollama")!;
const gigachat = providerPresetById("gigachat")!;

function filledEntry(preset: typeof openai): ProviderEntry {
  const entry = emptyProviderEntry(preset);
  return { ...entry, apiKey: "sk-test" };
}

describe("PROVIDER_PRESETS", () => {
  test("все пресеты содержат четыре tiers моделей", () => {
    for (const preset of PROVIDER_PRESETS) {
      for (const tier of MODEL_TIERS) {
        expect(preset.models[tier].length).toBeGreaterThan(0);
      }
    }
  });

  test("id уникальны, есть онлайн и локальные пресеты", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROVIDER_PRESETS.some((p) => p.kind === "online")).toBe(true);
    expect(PROVIDER_PRESETS.some((p) => p.kind === "local")).toBe(true);
  });

  test("пресет gigachat: oauth2, scope-опции и https-эндпоинты", () => {
    expect(gigachat.kind).toBe("online");
    expect(gigachat.auth?.kind).toBe("oauth2");
    expect(gigachat.auth?.scopeOptions.length).toBeGreaterThan(1);
    expect(gigachat.auth?.tokenUrl.startsWith("https://")).toBe(true);
    expect(gigachat.baseUrl.startsWith("https://")).toBe(true);
    expect(gigachat.verify.kind).toBe("openai");
    // oauth2-провайдер не предлагается инструментам: сторонние CLI не выполняют обмен ключа
    expect(gigachat.tools.openwiki).toBeUndefined();
    // сертификат НУЦ обязателен: без него API Сбера недоступен из Node
    expect(gigachat.cert?.required).toBe(true);
  });

  test("yandexgpt: карточка сразу за gigachat, статический ключ и опциональный сертификат", () => {
    const yandexgpt = providerPresetById("yandexgpt")!;
    expect(yandexgpt.auth).toBeUndefined();
    expect(yandexgpt.cert?.required).toBe(false);
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(ids.indexOf("yandexgpt")).toBe(ids.indexOf("gigachat") + 1);
  });
});

describe("providerStatus", () => {
  test("пустая запись - empty (карточка выглядит отключенной)", () => {
    expect(providerStatus(openai, null)).toBe("empty");
    expect(providerStatus(openai, emptyProviderEntry(openai))).toBe("empty");
  });

  test("заполненный без проверки - filled, кнопка проверки доступна", () => {
    expect(providerStatus(openai, filledEntry(openai))).toBe("filled");
    expect(providerComplete(openai, filledEntry(openai))).toBe(true);
  });

  test("провайдер без ключа (Ollama) заполнен значениями пресета", () => {
    expect(providerComplete(ollama, emptyProviderEntry(ollama))).toBe(true);
    expect(providerStatus(ollama, emptyProviderEntry(ollama))).toBe("filled");
  });

  test("успешная проверка делает провайдера активным", () => {
    const entry = { ...filledEntry(openai), verifiedAt: "2026-10-01T00:00:00Z" };
    expect(providerStatus(openai, entry)).toBe("active");
  });

  test("без ключа провайдер неактивен, даже если проверка была пройдена", () => {
    const withoutKey = { ...filledEntry(openai), apiKey: "", verifiedAt: "2026-10-01T00:00:00Z" };
    expect(isActiveProvider(openai, withoutKey)).toBe(false);
    expect(providerStatus(openai, withoutKey)).toBe("empty");
    // локальный провайдер без ключа по определению пресета остаётся активным после проверки
    const local = { ...emptyProviderEntry(ollama), verifiedAt: "2026-10-01T00:00:00Z" };
    expect(isActiveProvider(ollama, local)).toBe(true);
    expect(providerStatus(ollama, local)).toBe("active");
  });

  test("ошибка проверки - error", () => {
    const entry = { ...filledEntry(openai), verifyError: "HTTP 401" };
    expect(providerStatus(openai, entry)).toBe("error");
  });

  test("частично заполненные tiers - не заполнен", () => {
    const entry = { ...filledEntry(openai), models: { ...emptyProviderEntry(openai).models, strong: "" } };
    expect(providerComplete(openai, entry)).toBe(false);
    expect(providerStatus(openai, entry)).toBe("empty");
  });

  test("локальный сервис: не установлен и не запущен приоритетнее заполнения", () => {
    const complete = emptyProviderEntry(ollama);
    expect(providerStatus(ollama, complete, { installed: false, running: false })).toBe("not-installed");
    expect(providerStatus(ollama, complete, { installed: true, running: false })).toBe("not-running");
    expect(providerStatus(ollama, complete, { installed: true, running: true })).toBe("filled");
  });

  test("локальный незаполненный провайдер при работающем сервисе - empty", () => {
    const broken = { ...emptyProviderEntry(ollama), baseUrl: "" };
    expect(providerStatus(ollama, broken, { installed: true, running: true })).toBe("empty");
  });
});

describe("taskProviderId", () => {
  test("симметричные преобразования", () => {
    expect(parseTaskProviderId(taskProviderId("ollama"))).toBe("ollama");
    expect(parseTaskProviderId("claude")).toBe(null);
  });
});

describe("providerBaseUrlError", () => {
  test("http/https разрешены, прочие протоколы запрещены", () => {
    expect(providerBaseUrlError("http://localhost:11434/v1")).toBe(null);
    expect(providerBaseUrlError("https://api.openai.com/v1")).toBe(null);
    expect(providerBaseUrlError("file:///etc")).toContain("протокол");
    expect(providerBaseUrlError("ftp://x")).toContain("протокол");
  });

  test("userinfo и metadata-хост запрещены", () => {
    expect(providerBaseUrlError("https://user:pass@api.openai.com")).toContain("userinfo");
    expect(providerBaseUrlError("http://169.254.169.254/latest")).toContain("metadata");
  });

  test("невалидный URL отклоняется", () => {
    expect(providerBaseUrlError("не-url")).toContain("невалидный");
  });

  test("для онлайн-провайдеров локальные и приватные адреса запрещены", () => {
    expect(providerBaseUrlError("https://api.giga.chat/v1", "online")).toBe(null);
    expect(providerBaseUrlError("http://localhost:11434/v1", "online")).toContain("запрещены");
    expect(providerBaseUrlError("http://127.0.0.1:8080", "online")).toContain("запрещены");
    expect(providerBaseUrlError("http://10.0.0.5/v1", "online")).toContain("запрещены");
    expect(providerBaseUrlError("http://192.168.1.10/v1", "online")).toContain("запрещены");
    // локальные пресеты продолжают работать на loopback
    expect(providerBaseUrlError("http://localhost:11434/v1", "local")).toBe(null);
  });

  test("onlineHostError: приватные, зарезервированные и IPv6-локальные диапазоны", () => {
    expect(onlineHostError("localhost")).toContain("запрещены");
    expect(onlineHostError("172.16.0.1")).toContain("запрещены");
    expect(onlineHostError("169.254.10.10")).toContain("запрещены");
    expect(onlineHostError("240.0.0.1")).toContain("запрещены");
    expect(onlineHostError("::1")).toContain("запрещены");
    expect(onlineHostError("fc00::1")).toContain("запрещены");
    expect(onlineHostError("fe80::1")).toContain("запрещены");
    expect(onlineHostError("api.openai.com")).toBe(null);
    expect(onlineHostError("8.8.8.8")).toBe(null);
  });
});

describe("langgraphEnvFile", () => {
  test("ключ, base URL и модель каждого tier попадают в .env", () => {
    const text = langgraphEnvFile(openai, filledEntry(openai));
    const lines = text.trim().split("\n");
    expect(lines).toContain("LANGGRAPH_PROVIDER=openai");
    expect(lines).toContain("OPENAI_API_KEY=sk-test");
    expect(lines).toContain("OPENAI_BASE_URL=https://api.openai.com/v1");
    expect(lines.some((l) => l.startsWith("LANGGRAPH_MODEL_FAST="))).toBe(true);
    expect(lines.some((l) => l.startsWith("LANGGRAPH_MODEL_SUBAGENTS="))).toBe(true);
  });

  test("экспорт поддерживается только для статических ключей", () => {
    expect(langgraphSupported(openai)).toBe(true);
    expect(langgraphSupported(gigachat)).toBe(false);
  });
});

/** Мок fetch из заглушки-ответа (тип fetch строже - приведение через unknown). */
function mockFetch(handler: () => Promise<Response>): typeof fetch {
  return (async () => handler()) as unknown as typeof fetch;
}

describe("verifyProvider", () => {
  test("успешный ответ OpenAI-совместимого API - ok и список моделей", async () => {
    const result = await verifyProvider(
      openai,
      filledEntry(openai),
      mockFetch(async () => new Response(JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }), { status: 200 })),
    );
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  test("переданный token подставляется вместо ключа записи", async () => {
    const captured: { headers?: Headers } = {};
    const result = await verifyProvider(
      openai,
      filledEntry(openai),
      (async (_url: RequestInfo | URL, init?: RequestInit) => {
        captured.headers = new Headers(init?.headers);
        return new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), { status: 200 });
      }) as unknown as typeof fetch,
      "exchanged-access-token",
    );
    expect(result.ok).toBe(true);
    expect(captured.headers?.get("Authorization")).toBe("Bearer exchanged-access-token");
  });

  test("HTTP-ошибка возвращает статус для повтора OAuth", async () => {
    const result = await verifyProvider(gigachat, filledEntry(gigachat), mockFetch(async () => new Response("unauthorized", { status: 401 })));
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.error).toContain("401");
  });

  test("HTTP-ошибка превращается в verifyError", async () => {
    const result = await verifyProvider(openai, filledEntry(openai), mockFetch(async () => new Response("unauthorized", { status: 401 })));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  test("неожиданный формат ответа не проходит проверку", async () => {
    const result = await verifyProvider(
      openai,
      filledEntry(openai),
      mockFetch(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("формат");
  });

  test("сетевая ошибка - текст соединения", async () => {
    const result = await verifyProvider(
      ollama,
      emptyProviderEntry(ollama),
      mockFetch(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("соединение");
  });
});

describe("defaultState", () => {
  test("реестр провайдеров присутствует в состоянии по умолчанию", () => {
    const state = defaultState("/tmp/repo");
    expect(state.providers.entries).toEqual({});
    expect(state.providers.langgraphExport).toBe(null);
  });
});
