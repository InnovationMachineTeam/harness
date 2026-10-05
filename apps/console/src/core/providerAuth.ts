import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FetchLike, ProviderEntry, ProviderPreset } from "./providers";
import { providerFetch, type ProviderFetchInit } from "./providerHttp";

/**
 * Авторизация запросов к провайдерам. Статические пресеты (без preset.auth)
 * используют ключ записи как Bearer-токен. Пресеты со схемой oauth2 (GigaChat):
 * ключ авторизации (Basic) обменивается на короткоживущий access-токен в
 * tokenUrl; обмен кешируется в памяти процесса до истечения. После HTTP 401
 * кеш сбрасывается и обмен повторяется (withProviderAuth).
 */

export interface ResolvedProviderAuth {
  /** Токен запросов к API: статический ключ или обменянный access-токен. */
  token: string;
  /** PEM доверенного CA из поля "CA-файл" записи (если указан). */
  caPem?: string;
  /** Транспорт с подставленным CA и политикой хоста пресета. */
  fetch: FetchLike;
}

export type ResolveTokenResult = { ok: true; auth: ResolvedProviderAuth } | { ok: false; error: string };

export interface ProviderAuthDeps {
  /** Точка подмены в тестах. */
  transport?: typeof providerFetch;
  now?: () => number;
}

/** Запас до истечения access-токена, чтобы запрос успел дойти до API. */
const REFRESH_MARGIN_MS = 60_000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Полностью очистить кеш токенов (тесты). */
export function clearProviderTokenCache(): void {
  tokenCache.clear();
}

function cacheKey(preset: ProviderPreset, entry: ProviderEntry): string | null {
  if (preset.auth?.kind !== "oauth2") return null;
  const key = entry.apiKey.trim();
  if (!key) return null;
  const scope = entry.authScope?.trim() || preset.auth.scopeDefault;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${preset.id}:${scope}:${digest}`;
}

/** Сбросить кешированный access-токен провайдера (например, после HTTP 401). */
export function invalidateProviderToken(preset: ProviderPreset, entry: ProviderEntry): void {
  const key = cacheKey(preset, entry);
  if (key) tokenCache.delete(key);
}

/** Чтение CA-файла записи; ошибка чтения - текст для пользователя. */
function readCaPem(entry: ProviderEntry): { pem?: string; error?: string } {
  const file = entry.caFile?.trim();
  if (!file) return {};
  try {
    const pem = readFileSync(file, "utf8");
    if (!pem.includes("BEGIN CERTIFICATE")) {
      return { error: `CA-файл не содержит PEM-сертификат: ${file}` };
    }
    return { pem };
  } catch {
    return { error: `не удалось прочитать CA-файл: ${file}` };
  }
}

/**
 * Обмен ключа авторизации на access-токен: POST tokenUrl c Basic-ключом,
 * заголовком RqUID и scope в form-urlencoded теле. Ответ - access_token и
 * expires_at (секунды или миллисекунды).
 */
async function exchangeToken(
  preset: ProviderPreset,
  entry: ProviderEntry,
  caPem: string | undefined,
  transport: typeof providerFetch,
): Promise<{ token: string; expiresAt: number }> {
  const auth = preset.auth!;
  const key = entry.apiKey.trim();
  const scope = entry.authScope?.trim() || auth.scopeDefault;
  let res: Response;
  try {
    res = await transport(auth.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: randomUUID(),
        Authorization: `Basic ${key}`,
      },
      body: new URLSearchParams({ scope }).toString(),
      signal: AbortSignal.timeout(10_000),
      caPem,
      hostPolicy: "public",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`обмен ключа на access-токен не выполнен: ${message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`обмен ключа на access-токен: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: { access_token?: unknown; expires_at?: unknown };
  try {
    json = JSON.parse(text) as { access_token?: unknown; expires_at?: unknown };
  } catch {
    throw new Error("обмен ключа на access-токен: ответ не является JSON");
  }
  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("обмен ключа на access-токен: в ответе нет access_token");
  }
  const rawExpires = typeof json.expires_at === "number" ? json.expires_at : 0;
  const expiresAt = rawExpires > 1e12 ? rawExpires : rawExpires > 0 ? rawExpires * 1000 : 0;
  return { token: json.access_token, expiresAt };
}

/**
 * Токен и транспорт для запросов к провайдеру. Статические пресеты без
 * CA-файла продолжают через глобальный fetch - поведение не меняется.
 */
export async function resolveProviderToken(
  preset: ProviderPreset,
  entry: ProviderEntry,
  deps: ProviderAuthDeps = {},
): Promise<ResolveTokenResult> {
  const transport = deps.transport ?? providerFetch;
  const now = deps.now ?? Date.now;
  const ca = readCaPem(entry);
  if (ca.error) return { ok: false, error: ca.error };
  const bound: FetchLike = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return transport(url, {
      ...(init as ProviderFetchInit | undefined),
      caPem: ca.pem,
      hostPolicy: preset.kind === "local" ? "loopback-allowed" : "public",
    });
  };

  if (preset.auth?.kind !== "oauth2") {
    return { ok: true, auth: { token: entry.apiKey.trim(), caPem: ca.pem, fetch: ca.pem ? bound : fetch } };
  }

  const key = cacheKey(preset, entry);
  if (!key) return { ok: false, error: "ключ авторизации не заполнен" };
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) {
    return { ok: true, auth: { token: cached.token, caPem: ca.pem, fetch: bound } };
  }
  try {
    const fresh = await exchangeToken(preset, entry, ca.pem, transport);
    tokenCache.set(key, fresh);
    return { ok: true, auth: { token: fresh.token, caPem: ca.pem, fetch: bound } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Выполнить запрос с текущим токеном; при HTTP 401 у oauth2-провайдера кеш
 * сбрасывается, токен обменивается заново и запрос повторяется один раз.
 */
export async function withProviderAuth<T>(
  preset: ProviderPreset,
  entry: ProviderEntry,
  make: (auth: ResolvedProviderAuth) => Promise<T>,
  isUnauthorized: (result: T) => boolean,
  deps: ProviderAuthDeps = {},
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let resolved = await resolveProviderToken(preset, entry, deps);
  if (!resolved.ok) return resolved;
  let result = await make(resolved.auth);
  if (isUnauthorized(result) && preset.auth?.kind === "oauth2") {
    invalidateProviderToken(preset, entry);
    resolved = await resolveProviderToken(preset, entry, deps);
    if (!resolved.ok) return resolved;
    result = await make(resolved.auth);
  }
  return { ok: true, value: result };
}
