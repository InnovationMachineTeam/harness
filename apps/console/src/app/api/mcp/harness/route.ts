import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadHarnessMcpConfig } from "@/mcp-server/config";
import { buildHarnessMcpServer, type HarnessMcpServer } from "@/mcp-server/server";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * HTTP-транспорт собственного MCP-сервера harness (streamable HTTP, ответы JSON).
 * Каждая сессия (заголовок mcp-session-id) получает свой экземпляр сервера со
 * свежим конфигом; карта сессий живёт в процессе консоли - рестарт консоли
 * разрывает сессии, клиент переподключается. Включённый endpoint требует
 * заголовок Authorization: Bearer <token> (state.mcpHttp).
 */

interface HarnessSession {
  transport: WebStandardStreamableHTTPServerTransport;
  harness: HarnessMcpServer;
}

const sessions = new Map<string, HarnessSession>();

function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Авторизация: выключенный endpoint - 403, неверный токен - 401. */
async function authorize(request: Request): Promise<Response | null> {
  const { state } = await serverContext();
  const auth = request.headers.get("authorization") ?? "";
  if (!state.mcpHttp?.enabled || !state.mcpHttp.token) {
    return Response.json({ error: "HTTP-транспорт MCP-сервера harness выключен (Настройки - MCP - сервер harness)" }, { status: 403 });
  }
  if (!tokenMatches(state.mcpHttp.token, auth.startsWith("Bearer ") ? auth.slice(7) : "")) {
    return Response.json({ error: "неверный Bearer-токен" }, { status: 401 });
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied) return denied;

  const sessionId = request.headers.get("mcp-session-id") ?? undefined;
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (sessionId && !existing) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "сессия MCP не найдена или устарела - переподключитесь" } }, { status: 404 });
  }
  if (existing) return existing.transport.handleRequest(request);

  const { repoRoot } = await serverContext();
  const harness = await buildHarnessMcpServer({ repoRoot, config: await loadHarnessMcpConfig(repoRoot) });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport, harness });
    },
    onsessionclosed: (sessionId) => {
      harness.stop();
      sessions.delete(sessionId);
    },
  });
  transport.onclose = () => {
    harness.stop();
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  await harness.server.connect(transport);
  return transport.handleRequest(request);
}

/** GET - поток серверных сообщений; для JSON-режима транспорт отвечает 405 сам. */
export async function GET(request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied) return denied;
  const sessionId = request.headers.get("mcp-session-id") ?? "";
  const existing = sessions.get(sessionId);
  if (!existing) return Response.json({ error: "сессия MCP не найдена" }, { status: 404 });
  return existing.transport.handleRequest(request);
}

/** DELETE - завершение сессии (транспорт закрывается, onsessionclosed убирает карту). */
export async function DELETE(request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied) return denied;
  const sessionId = request.headers.get("mcp-session-id") ?? "";
  const existing = sessions.get(sessionId);
  if (!existing) return Response.json({ error: "сессия MCP не найдена" }, { status: 404 });
  return existing.transport.handleRequest(request);
}
