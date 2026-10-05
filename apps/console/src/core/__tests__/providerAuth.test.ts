import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearProviderTokenCache,
  invalidateProviderToken,
  resolveProviderToken,
  withProviderAuth,
  type ProviderAuthDeps,
} from "@/core/providerAuth";
import type { ProviderFetchInit, providerFetch } from "@/core/providerHttp";
import { emptyProviderEntry, providerPresetById, type ProviderEntry } from "@/core/providers";

const gigachat = providerPresetById("gigachat")!;
const openai = providerPresetById("openai")!;

/** Фиктивное значение ключа авторизации для тестов (не секрет). */
const TEST_AUTH_KEY = "sk-test";

function gigachatEntry(): ProviderEntry {
  return { ...emptyProviderEntry(gigachat), apiKey: TEST_AUTH_KEY };
}

interface Recorded {
  url: string;
  init: ProviderFetchInit;
}

/** Очередь ответов: каждый вызов транспорта снимает следующий обработчик. */
function transportQueue(responses: Array<{ status?: number; body?: string }>) {
  const calls: Recorded[] = [];
  const transport = (async (url: string, init: ProviderFetchInit): Promise<Response> => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("неожиданный вызов транспорта");
    return new Response(next.body ?? "{}", { status: next.status ?? 200 });
  }) as unknown as typeof providerFetch;
  return { transport, calls };
}

function oauthResponse(expiresAtMs: number): string {
  return JSON.stringify({ access_token: `token-${expiresAtMs}`, expires_at: expiresAtMs });
}

afterEach(() => {
  clearProviderTokenCache();
});

describe("resolveProviderToken: статические пресеты", () => {
  test("ключ записи возвращается как токен, транспорт - глобальный fetch", async () => {
    const deps: ProviderAuthDeps = {
      transport: (() => Promise.reject(new Error("не должен вызываться"))) as unknown as typeof providerFetch,
    };
    const result = await resolveProviderToken(openai, { ...emptyProviderEntry(openai), apiKey: "sk-key" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.token).toBe("sk-key");
      expect(result.auth.fetch).toBe(fetch);
    }
  });

  test("несуществующий CA-файл - ошибка с путём", async () => {
    const result = await resolveProviderToken(openai, { ...emptyProviderEntry(openai), apiKey: "sk", caFile: "/nonexistent/ca.pem" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("CA-файл");
  });
});

describe("resolveProviderToken: oauth2 (GigaChat)", () => {
  test("обмен ключа: POST tokenUrl c Basic-ключом, RqUID и scope в теле", async () => {
    const expiresAt = Date.now() + 30 * 60_000;
    const { transport, calls } = transportQueue([{ body: oauthResponse(expiresAt) }]);
    const result = await resolveProviderToken(gigachat, gigachatEntry(), { transport });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(gigachat.auth ? gigachat.auth.tokenUrl : "");
    expect(calls[0].init.method).toBe("POST");
    const headers = new Headers(calls[0].init.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe(`Basic ${TEST_AUTH_KEY}`);
    expect(headers.get("RqUID")).toBeTruthy();
    expect(calls[0].init.body).toBe("scope=GIGACHAT_API_PERS");
    if (result.ok) expect(result.auth.token).toBe(`token-${expiresAt}`);
  });

  test("валидный токен не обменивается повторно; expires_at в секундах принимается", async () => {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 30 * 60;
    const { transport, calls } = transportQueue([{ body: oauthResponse(expiresAtSeconds) }]);
    const first = await resolveProviderToken(gigachat, gigachatEntry(), { transport });
    expect(first.ok).toBe(true);
    const second = await resolveProviderToken(gigachat, gigachatEntry(), { transport });
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("HTTP-ошибка обмена - текст ошибки", async () => {
    const { transport } = transportQueue([{ status: 401, body: "invalid client secret" }]);
    const result = await resolveProviderToken(gigachat, gigachatEntry(), { transport });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("401");
      expect(result.error).toContain("обмен ключа");
    }
  });

  test("authScope записи переопределяет scope по умолчанию", async () => {
    const { transport, calls } = transportQueue([{ body: oauthResponse(Date.now() + 30 * 60_000) }]);
    const entry = { ...gigachatEntry(), authScope: "GIGACHAT_API_B2B" };
    await resolveProviderToken(gigachat, entry, { transport });
    expect(calls[0].init.body).toBe("scope=GIGACHAT_API_B2B");
  });
});

describe("withProviderAuth: повтор после HTTP 401", () => {
  test("401 сбрасывает кеш, обмен повторяется, запрос выполняется второй раз", async () => {
    const expiresAt = Date.now() + 30 * 60_000;
    // последовательность вызовов: обмен, API-запрос (401), обмен, API-запрос (200)
    const { transport, calls } = transportQueue([
      { body: oauthResponse(expiresAt) },
      { status: 401, body: "expired" },
      { body: oauthResponse(expiresAt + 1000) },
      { status: 200, body: "ok" },
    ]);
    const result = await withProviderAuth(
      gigachat,
      gigachatEntry(),
      async (auth) => auth.fetch("https://api.giga.chat/v1/models", { headers: { Authorization: `Bearer ${auth.token}` } }),
      (res) => res.status === 401,
      { transport },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(await result.value.text()).toBe("ok");
    expect(calls).toHaveLength(4);
    expect(calls[1].url).toContain("/v1/models");
    expect(calls[3].url).toContain("/v1/models");
  });

  test("статический провайдер без обмена возвращает результат одного запроса", async () => {
    const { transport, calls } = transportQueue([{ status: 200, body: "fine" }]);
    const result = await withProviderAuth(
      openai,
      { ...emptyProviderEntry(openai), apiKey: "sk-key" },
      async () => new Response("fine", { status: 200 }),
      () => false,
      { transport },
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("invalidateProviderToken", () => {
  test("после сброса кеша обмен выполняется заново", async () => {
    const expiresAt = Date.now() + 30 * 60_000;
    const { transport, calls } = transportQueue([{ body: oauthResponse(expiresAt) }, { body: oauthResponse(expiresAt) }]);
    const entry = gigachatEntry();
    await resolveProviderToken(gigachat, entry, { transport });
    invalidateProviderToken(gigachat, entry);
    await resolveProviderToken(gigachat, entry, { transport });
    expect(calls).toHaveLength(2);
  });
});

describe("CA-файл", () => {
  test("валидный PEM подставляется в транспорт", async () => {
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const file = join(await mkdtemp(join(tmpdir(), "provider-auth-ca-")), "ca.pem");
    await writeFile(file, pem, "utf8");
    const { transport, calls } = transportQueue([{ body: oauthResponse(Date.now() + 30 * 60_000) }]);
    const result = await resolveProviderToken(gigachat, { ...gigachatEntry(), caFile: file }, { transport });
    expect(result.ok).toBe(true);
    expect(calls[0].init.caPem).toBe(pem);
  });
});
