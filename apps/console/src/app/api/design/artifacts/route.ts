import { NextResponse } from "next/server";
import path from "node:path";
import { callMcpTool, listMcpTools } from "@/core/mcp/client";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/design/artifacts {dir}
 * Артефакты open-design для рабочей папки: список инструментов сервера и
 * вызов первого list-инструмента (list_projects). Только чтение; сервер
 * выключен или недоступен - ok:false с подсказкой, ошибки не выбрасываются.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: unknown } | null;
  const dir = body && typeof body.dir === "string" ? path.resolve(body.dir) : null;
  if (!dir || !workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в рабочие папки консоли" }, { status: 400 });
  }
  const def = ctx.state.mcp.servers["open-design"];
  if (!def) {
    return NextResponse.json({ ok: false, error: "open-design нет в реестре MCP - установите инструмент (Настройки → Инструменты)" });
  }
  if (!def.enabled) {
    return NextResponse.json({ ok: false, error: "open-design выключен в реестре MCP (Настройки → MCP)" });
  }
  const listed = await listMcpTools({ cwd: dir, servers: [def] });
  const group = listed[0];
  if (!group || group.error) {
    return NextResponse.json({ ok: false, error: `open-design недоступен: ${group?.error ?? "сервер не ответил"}` });
  }
  const tools = group.tools.map((tool) => tool.qualifiedName);
  const listTool = group.tools.find((tool) => /list/i.test(tool.name));
  if (!listTool) {
    return NextResponse.json({ ok: true, tools, list: null });
  }
  const call = await callMcpTool({ cwd: dir, servers: [def], qualifiedName: listTool.qualifiedName, args: {} });
  return NextResponse.json({
    ok: true,
    tools,
    list: { tool: listTool.qualifiedName, ok: call.ok, output: call.output.slice(0, 16_000) },
  });
}
