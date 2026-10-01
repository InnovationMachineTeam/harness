import { NextResponse } from "next/server";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** POST /api/plugins/marketplace {name, url} - добавить каталог плагинов. */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { name?: string; url?: string } | null;
  const name = body?.name?.trim() ?? "";
  const url = body?.url?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,48}$/.test(name)) {
    return NextResponse.json({ error: "имя: латиница/цифры/-/_ ." }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "некорректный URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "только http/https" }, { status: 400 });
  }
  if (ctx.state.plugins.marketplaces.some((m) => m.name === name || m.url === url)) {
    return NextResponse.json({ error: "такой marketplace уже добавлен" }, { status: 400 });
  }
  ctx.state.plugins.marketplaces.push({ name, url });
  await ctx.saveState();
  return NextResponse.json({ ok: true, marketplaces: ctx.state.plugins.marketplaces });
}

/** DELETE /api/plugins/marketplace?name= - убрать каталог. */
export async function DELETE(request: Request) {
  const ctx = await serverContext();
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const before = ctx.state.plugins.marketplaces.length;
  ctx.state.plugins.marketplaces = ctx.state.plugins.marketplaces.filter((m) => m.name !== name);
  if (ctx.state.plugins.marketplaces.length === before) {
    return NextResponse.json({ error: `marketplace не найден: ${name}` }, { status: 404 });
  }
  await ctx.saveState();
  return NextResponse.json({ ok: true, marketplaces: ctx.state.plugins.marketplaces });
}
