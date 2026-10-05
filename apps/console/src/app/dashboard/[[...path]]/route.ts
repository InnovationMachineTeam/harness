import { NextResponse } from "next/server";
import { injectHeadroomShim } from "@/core/headroomEmbed";

export const dynamic = "force-dynamic";

/**
 * Embed-прокси дашборда Headroom (GET /dashboard/*).
 *
 * Headroom ставит `x-frame-options: DENY`, поэтому iframe с тем же origin
 * отклоняется браузером. Роут транслирует /dashboard/* на литеральный
 * локальный апстрим 127.0.0.1:8787 и снимает заголовки фрейминга - контент
 * становится same-origin для консоли. В HTML инжектится fetch-shim
 * (core/headroomEmbed.ts): root-relative запросы данных (/stats, /health, ...)
 * уходят на /headroom-api/* (роут-прокси того же апстрима), иначе в iframe
 * они попадают на origin консоли и дают 404. Ограничения: только GET,
 * сегменты пути без "..", апстрим - литерал (не пользовательский ввод).
 * Доступность сервиса - TCP-проба (core/dashboards.ts), этот роут
 * только для встраивания.
 */

const UPSTREAM = "http://127.0.0.1:8787/dashboard";

export async function GET(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const sub = Array.isArray(path) && path.length > 0 ? `/${path.join("/")}` : "";
  // защита от ../ в сегментах (в URL он и так не выживет, но явно)
  if (sub.includes("..")) return NextResponse.json({ error: "недопустимый путь" }, { status: 400 });
  const search = new URL(request.url).search;
  try {
    const upstream = await fetch(`${UPSTREAM}${sub}${search}`, {
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const headers = new Headers();
    for (const [key, value] of upstream.headers) {
      const k = key.toLowerCase();
      // фрейминг снимаем; content-encoding/length - fetch уже декодировал
      if (k === "x-frame-options" || k === "content-security-policy" || k === "content-encoding" || k === "content-length" || k === "transfer-encoding") {
        continue;
      }
      headers.set(key, value);
    }
    headers.set("cache-control", "no-store");
    const contentType = upstream.headers.get("content-type") ?? "";
    const body = contentType.includes("text/html") ? injectHeadroomShim(await upstream.text()) : upstream.body;
    return new Response(body, { status: upstream.status, headers });
  } catch (err) {
    return NextResponse.json(
      { error: `дашборд Headroom недоступен: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
