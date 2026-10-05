import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Прокси API дашборда Headroom (GET|POST /headroom-api/*).
 *
 * Дашборд, встроенный через /dashboard/*, запрашивает данные root-relative
 * путями (/stats, /health, /settings, ...); shim (core/headroomEmbed.ts)
 * направляет их сюда, роут транслирует путь 1:1 на литеральный апстрим
 * 127.0.0.1:8787. Ограничения те же, что у embed-прокси /dashboard/*:
 * сегменты пути без "..", апстрим - литерал (не пользовательский ввод);
 * из ответа снимаются заголовки фрейминга и content-encoding/length.
 */

const UPSTREAM = "http://127.0.0.1:8787";

async function proxy(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const sub = Array.isArray(path) && path.length > 0 ? `/${path.join("/")}` : "/";
  // защита от ../ в сегментах (в URL он и так не выживет, но явно)
  if (sub.includes("..")) return NextResponse.json({ error: "недопустимый путь" }, { status: 400 });
  const search = new URL(request.url).search;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  try {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const upstream = await fetch(`${UPSTREAM}${sub}${search}`, {
      method: request.method,
      headers,
      body,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const out = new Headers();
    for (const [key, value] of upstream.headers) {
      const k = key.toLowerCase();
      // фрейминг снимаем; content-encoding/length и hop-by-hop - fetch уже декодировал
      if (
        k === "x-frame-options" ||
        k === "content-security-policy" ||
        k === "content-encoding" ||
        k === "content-length" ||
        k === "transfer-encoding" ||
        k === "connection"
      ) {
        continue;
      }
      out.set(key, value);
    }
    out.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (err) {
    return NextResponse.json(
      { error: `дашборд Headroom недоступен: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}

export { proxy as GET, proxy as POST };
