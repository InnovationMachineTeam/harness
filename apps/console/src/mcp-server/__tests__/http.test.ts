import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * HTTP-транспорт MCP-сервера harness: route handler вызывается напрямую
 * (Request - Response); репозиторий - фикстура через HARNESS_ROOT.
 */

const TOKEN = "test-token-0123456789abcdef";

let root = "";
let route: typeof import("@/app/api/mcp/harness/route");

function mcpRequest(method: "POST" | "GET" | "DELETE", body?: unknown, sessionId?: string): Request {
  return new Request("http://harness.local/api/mcp/harness", {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { "content-type": "application/json", accept: "application/json, text/event-stream" } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function initializeRequest(id: number): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "harness-test", version: "1.0.0" } },
  };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-mcp-http-"));
  await mkdir(path.join(root, ".agents", "console"), { recursive: true });
  await mkdir(path.join(root, ".agents", "runtime"), { recursive: true });
  await writeFile(path.join(root, ".agents", "runtime", "config.json"), "{}", "utf8");
  await writeFile(
    path.join(root, ".agents", "console", "state.json"),
    JSON.stringify({ workspaces: { mandatory: root, additional: [], openwiki: [], graphify: [], docs: [] }, mcpHttp: { enabled: true, token: TOKEN } }),
    "utf8",
  );
  process.env.HARNESS_ROOT = root;
  route = await import("@/app/api/mcp/harness/route");
});

afterAll(async () => {
  delete process.env.HARNESS_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("авторизация HTTP-транспорта", () => {
  test("выключенный endpoint - 403, неверный токен - 401", async () => {
    const stateFile = path.join(root, ".agents", "console", "state.json");
    const original = await Bun.file(stateFile).text();

    await writeFile(stateFile, JSON.stringify({ mcpHttp: { enabled: false, token: TOKEN } }), "utf8");
    const disabled = await route.POST(mcpRequest("POST", initializeRequest(1)));
    expect(disabled.status).toBe(403);

    await writeFile(stateFile, original, "utf8");
    const wrongToken = await route.POST(
      new Request("http://harness.local/api/mcp/harness", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
        body: JSON.stringify(initializeRequest(2)),
      }),
    );
    expect(wrongToken.status).toBe(401);
  });
});

describe("сессия streamable HTTP", () => {
  test("initialize создаёт сессию; tools/list и call работают; DELETE закрывает", async () => {
    const init = await route.POST(mcpRequest("POST", initializeRequest(10)));
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initBody = (await init.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(initBody.result?.serverInfo?.name).toBe("harness");

    await route.POST(mcpRequest("POST", { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId!));

    const tools = await route.POST(mcpRequest("POST", { jsonrpc: "2.0", id: 11, method: "tools/list" }, sessionId!));
    expect(tools.status).toBe(200);
    const toolsBody = (await tools.json()) as { result?: { tools?: Array<{ name: string }> } };
    const names = toolsBody.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("list_workspaces");
    expect(names).toContain("run_prompt");

    const call = await route.POST(
      mcpRequest("POST", { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "list_workspaces", arguments: {} } }, sessionId!),
    );
    expect(call.status).toBe(200);
    const callBody = (await call.json()) as { result?: { content?: Array<{ text?: string }> } };
    const text = callBody.result?.content?.[0]?.text ?? "";
    expect(JSON.parse(text)[0]).toMatchObject({ dir: root, mode: "write", exposed: true });

    const removed = await route.DELETE(mcpRequest("DELETE", undefined, sessionId!));
    expect([200, 204]).toContain(removed.status);
    const afterDelete = await route.POST(mcpRequest("POST", { jsonrpc: "2.0", id: 13, method: "tools/list" }, sessionId!));
    expect(afterDelete.status).toBe(404);
  });

  test("запрос с неизвестным идентификатором сессии - 404", async () => {
    const missing = await route.POST(mcpRequest("POST", { jsonrpc: "2.0", id: 20, method: "tools/list" }, "00000000-missing-session"));
    expect(missing.status).toBe(404);
  });
});
