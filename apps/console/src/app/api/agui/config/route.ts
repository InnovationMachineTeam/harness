import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/agui/config - управление AG-UI endpoint (Настройки → Основные):
 * включение, токен Bearer и его регенерация. Токен хранится в state.json
 * (вне git) и передаётся внешнему клиенту (например, OpenBot) для заголовка
 * Authorization.
 */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({
    enabled: ctx.state.agui?.enabled ?? false,
    token: ctx.state.agui?.token ?? "",
  });
}

export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as { enabled?: boolean; regenerate?: boolean } | null;
  try {
    const current = ctx.state.agui ?? { enabled: false, token: "" };
    let token = current.token;
    if (body?.regenerate || !token) token = randomBytes(24).toString("base64url");
    ctx.state.agui = {
      enabled: body?.enabled ?? current.enabled,
      token,
    };
    await ctx.saveState();
    return NextResponse.json(ctx.state.agui);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
