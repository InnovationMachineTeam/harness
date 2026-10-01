import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { isValidMcpName, syncMcp } from "@/core/mcp/sync";
import type { McpTransport } from "@/core/types";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/mcp - реестр + результаты последнего синка по таргетам. */
export async function GET() {
  const { state } = await serverContext();
  return NextResponse.json({
    servers: Object.values(state.mcp.servers),
    targets: Object.values(state.lastMcpSync),
  });
}

function parseTransport(input: unknown): { ok: true; transport: McpTransport } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "transport не задан" };
  const t = input as Record<string, unknown>;
  if (t.type === "stdio" && typeof t.command === "string" && t.command.trim()) {
    const transport: McpTransport = {
      type: "stdio",
      command: t.command.trim(),
      ...(Array.isArray(t.args) ? { args: t.args.map(String) } : {}),
      ...(t.env && typeof t.env === "object" && !Array.isArray(t.env) ? { env: t.env as Record<string, string> } : {}),
    };
    return { ok: true, transport };
  }
  if (t.type === "http" && typeof t.url === "string" && /^https?:\/\//.test(t.url)) {
    return {
      ok: true,
      transport: {
        type: "http",
        url: t.url.trim(),
        ...(t.headers && typeof t.headers === "object" && !Array.isArray(t.headers)
          ? { headers: t.headers as Record<string, string> }
          : {}),
      },
    };
  }
  return { ok: false, error: "ожидался stdio {command,args?,env?} или http {url}" };
}

/** POST /api/mcp - добавить/обновить сервер и прогнать синк. */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { name?: string; transport?: unknown } | null;
  const name = body?.name?.trim() ?? "";
  if (!isValidMcpName(name)) {
    return NextResponse.json({ error: "имя: латиница/цифры/-/_ , до 64 символов" }, { status: 400 });
  }
  const parsed = parseTransport(body?.transport);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  ctx.state.mcp.servers[name] = { name, transport: parsed.transport, enabled: true };
  const results = await syncMcp(ctx.repoRoot, ctx.state);
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, results: Object.values(results) });
}

/** PATCH /api/mcp - транспорт, глобальный toggle или override рантайма, затем синк. */
export async function PATCH(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { name?: string; enabled?: boolean; transport?: unknown; runtimeOverride?: { runtime: string; value: boolean | null } }
    | null;
  const name = body?.name ?? "";
  const def = ctx.state.mcp.servers[name];
  if (!def) return NextResponse.json({ error: `сервер не найден: ${name}` }, { status: 404 });

  const parsedTransport = body?.transport !== undefined ? parseTransport(body.transport) : null;
  if (parsedTransport && !parsedTransport.ok) {
    return NextResponse.json({ error: parsedTransport.error }, { status: 400 });
  }

  if (parsedTransport) def.transport = parsedTransport.transport;
  if (typeof body?.enabled === "boolean") def.enabled = body.enabled;
  const ro = body?.runtimeOverride;
  if (ro && typeof ro.runtime === "string" && typeof ro.value === "boolean") {
    def.runtimeOverrides = { ...def.runtimeOverrides, [ro.runtime]: ro.value };
  } else if (ro && ro.value === null && typeof ro.runtime === "string") {
    delete def.runtimeOverrides?.[ro.runtime];
  }

  const results = await syncMcp(ctx.repoRoot, ctx.state);
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, server: def, results: Object.values(results) });
}

/** DELETE /api/mcp?name= - убрать из реестра и из всех файлов. */
export async function DELETE(request: Request) {
  const ctx = await serverContext();
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!ctx.state.mcp.servers[name]) {
    return NextResponse.json({ error: `сервер не найден: ${name}` }, { status: 404 });
  }
  delete ctx.state.mcp.servers[name];
  const results = await syncMcp(ctx.repoRoot, ctx.state);
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, results: Object.values(results) });
}
