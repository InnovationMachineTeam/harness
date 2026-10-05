import http from "node:http";
import https from "node:https";
import { onlineHostError } from "./providers";

/**
 * Серверный транспорт для запросов к провайдерам. Глобальный fetch (undici)
 * не позволяет подставить доверенный CA в отдельный запрос, а цепочка
 * сертификатов Сбера/НУЦ не входит в набор Mozilla - поэтому транспорт
 * построен на node:http/https и принимает PEM-сертификат CA. Сигнатура
 * совместима с fetch: (url, init) => Promise<Response> - точка подмены в
 * тестах verifyProvider/providerRun не меняется.
 */

export interface ProviderFetchInit extends RequestInit {
  /** PEM-сертификат доверенного CA для этого запроса (поле "CA-файл" карточки). */
  caPem?: string;
  /**
   * "public" - локальные, приватные и зарезервированные хосты запрещены
   * (онлайн-провайдеры); "loopback-allowed" - разрешены (локальные сервисы).
   */
  hostPolicy?: "public" | "loopback-allowed";
}

/** Ссылка на страницу загрузки корневого сертификата НУЦ Минцифры. */
export const NUC_CA_URL = "https://www.gosuslugi.ru/ca";

/** Проверка URL до соединения: протокол http/https и политика хоста. */
export function providerUrlError(url: string, policy: "public" | "loopback-allowed"): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "невалидный URL запроса";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "запрос возможен только по http и https";
  }
  if (!parsed.hostname) {
    return "в URL не указан хост";
  }
  if (parsed.hostname === "169.254.169.254") {
    return "облачный metadata-хост запрещён";
  }
  if (policy === "public") {
    const hostError = onlineHostError(parsed.hostname);
    if (hostError) return hostError.replace("base URL: ", "хост запроса: ");
  }
  return null;
}

/** Ошибка TLS превращается в инструкцию: какой сертификат скачать и куда указать. */
function tlsHint(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code ?? "";
  const isTls =
    code.startsWith("ERR_TLS") ||
    code.includes("CERT") ||
    /certificate|tls/i.test(message);
  if (!isTls) return null;
  return (
    `цепочка сертификата не доверена (${code || message}). ` +
    `Для GigaChat/Сбера скачайте корневой сертификат НУЦ Минцифры (${NUC_CA_URL}) ` +
    `и загрузите PEM-файл кнопкой в карточке провайдера`
  );
}

/**
 * fetch-совместимый запрос через node:http/https: поддерживает caPem и
 * политику хоста; таймаут и отмена - через init.signal. Бросает Error с
 * понятным текстом (валидация URL, TLS, таймаут, сеть).
 */
export function providerFetch(url: string, init: ProviderFetchInit = {}): Promise<Response> {
  const policy = init.hostPolicy ?? "public";
  const urlError = providerUrlError(url, policy);
  if (urlError) {
    return Promise.reject(new Error(urlError));
  }
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit | undefined).forEach((value, key) => {
      headers[key] = value;
    });
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        headers,
        ca: init.caPem,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = res.statusCode ?? 200;
          resolve(new Response(body, { status, statusText: res.statusMessage ?? undefined, headers: responseHeaders }));
        });
        res.on("error", (err) => reject(err));
      },
    );
    req.on("error", (err) => {
      const hint = tlsHint(err);
      reject(hint ? new Error(hint) : err);
    });
    if (init.signal) {
      const signal = init.signal;
      const onAbort = () => {
        req.destroy(new Error(signal.reason instanceof Error ? signal.reason.message : "запрос отменён"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (init.body !== undefined && init.body !== null) {
      req.write(typeof init.body === "string" ? init.body : String(init.body));
    }
    req.end();
  });
}
