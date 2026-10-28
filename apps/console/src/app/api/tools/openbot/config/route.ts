import { NextResponse } from "next/server";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/tools/openbot/config - ключи OpenBot (шестерёнка карточки
 * инструмента): ключ CopilotKit Intelligence, ключ и базовый URL модели,
 * однопользовательский режим. Значения хранятся в state.openbotConfig
 * (вне git) и дописываются в .env каталога клонирования при старте сервиса.
 */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({ config: ctx.state.openbotConfig ?? { singleUser: true } });
}

export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as {
    intelligenceKey?: string;
    modelKey?: string;
    modelBaseUrl?: string;
    singleUser?: boolean;
  } | null;
  try {
    const str = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
    const modelBaseUrl = str(body?.modelBaseUrl, 256);
    if (modelBaseUrl && !/^https?:\/\//.test(modelBaseUrl)) throw new Error("modelBaseUrl должен быть http(s)-адресом");
    ctx.state.openbotConfig = {
      intelligenceKey: str(body?.intelligenceKey, 256),
      modelKey: str(body?.modelKey, 256),
      modelBaseUrl,
      singleUser: body?.singleUser !== false,
    };
    await ctx.saveState();
    return NextResponse.json({ config: ctx.state.openbotConfig });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
