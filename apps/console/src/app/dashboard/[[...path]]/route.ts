import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Embed-прокси дашборда Headroom (GET /dashboard/*).
 *
 * Headroom ставит `x-frame-options: DENY`, поэтому iframe с тем же origin
 * отклоняется браузером. Роут транслирует /dashboard/* на литеральный
 * локальный апстрим 127.0.0.1:8787 и снимает заголовки фрейминга - контент
 * становится same-origin для консоли. Ограничения: только GET, сегменты пути
 * без "..", апстрим - литерал (не пользовательский ввод); тело передаётся
 * как есть. Доступность сервиса - TCP-проба (core/dashboards.ts), этот роут
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
      if (k === "x-frame-options" || k === "content-security-policy" || k === "content-encoding" || k === "content-length") {
        continue;
      }
      headers.set(key, value);
    }
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return NextResponse.json(
      { error: `дашборд Headroom недоступен: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
