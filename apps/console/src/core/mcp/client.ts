import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { capToolOutput } from "../agentTools";

/**
 * MCP-клиент консоли: подключается к серверам из реестра state.mcp.servers
 * и передаёт их инструменты агентному циклу (Ассистент, provider-кандидаты
 * шагов workflow). Отличие от core/mcp/sync.ts: синк пишет конфиги внешним
 * рантаймам и ничего не запускает; клиент держит соединения в процессе
 * консоли/воркера. Команда и аргументы stdio-сервера - литеральные значения
 * из записи реестра, которую заполняет пользователь в "Настройки - MCP";
 * спавн выполняет SDK без оболочки (аргумент-список).
 *
 * Соединение ленивое, с повторным использованием и остановкой по простою.
 */

/** Таймаут вызова инструмента и запуска сервера. */
const CALL_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 30_000;

/** Простой соединения до остановки процесса сервера. */
const IDLE_SHUTDOWN_MS = 5 * 60_000;

/** Префикс и разделитель полного имени инструмента в пространстве цикла. */
const TOOL_PREFIX = "mcp__";
const TOOL_SEPARATOR = "__";

/** Полное имя инструмента сервера в пространстве цикла: mcp__<server>__<tool>. */
export function mcpQualifiedName(server: string, tool: string): string {
  return TOOL_PREFIX + server + TOOL_SEPARATOR + tool;
}

/** Разбор полного имени; null - имя не из пространства MCP. */
export function parseMcpQualifiedName(qualifiedName: string): { server: string; tool: string } | null {
  if (!qualifiedName.startsWith(TOOL_PREFIX)) return null;
  const rest = qualifiedName.slice(TOOL_PREFIX.length);
  const separatorAt = rest.indexOf(TOOL_SEPARATOR);
  if (separatorAt <= 0 || separatorAt + TOOL_SEPARATOR.length >= rest.length) return null;
  const server = rest.slice(0, separatorAt);
  const tool = rest.slice(separatorAt + TOOL_SEPARATOR.length);
  if (!server || !tool) return null;
  return { server, tool };
}

interface ManagedConnection {
  client: Client;
  lastUsed: number;
}

/** Ключ соединения: серверы запускаются на рабочую папку. */
function connectionKey(cwd: string, name: string): string {
  return cwd + " " + name;
}

const connections = new Map<string, Promise<ManagedConnection>>();

function reaper(): void {
  const now = Date.now();
  for (const [key, pending] of connections) {
    void pending.then((connection) => {
      if (now - connection.lastUsed < IDLE_SHUTDOWN_MS) return;
      connections.delete(key);
      void connection.client.close().catch(() => undefined);
    }, () => undefined);
  }
}

const reaperTimer = setInterval(reaper, 60_000);
reaperTimer.unref?.();

/** Закрыть все соединения (тесты и остановка процесса). */
export async function closeAllMcpConnections(): Promise<void> {
  const pending = [...connections.entries()];
  connections.clear();
  await Promise.allSettled(pending.map(([, promise]) => promise.then((connection) => connection.client.close())));
}

/**
 * Окружение stdio-сервера: переменные из реестра поверх окружения консоли.
 * Без наследования сервер не найдёт интерпретаторы и бинарники (PATH).
 */
function serverEnv(overrides: Record<string, string> | undefined): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) merged[key] = value;
  return merged;
}

async function openConnection(cwd: string, def: import("../types").McpServerDef): Promise<ManagedConnection> {
  const client = new Client({ name: "harness-console", version: "1.0.0" });
  if (def.transport.type === "stdio") {
    // Команда и аргументы - литеральные значения реестра; SDK спавнит
    // процесс аргумент-списком, без оболочки.
    const transport = new StdioClientTransport({
      command: def.transport.command,
      args: def.transport.args ?? [],
      env: serverEnv(def.transport.env),
      cwd,
    });
    await client.connect(transport, { timeout: START_TIMEOUT_MS });
  } else {
    const transport = new StreamableHTTPClientTransport(new URL(def.transport.url), {
      requestInit: { headers: def.transport.headers ?? {} },
    });
    await client.connect(transport, { timeout: START_TIMEOUT_MS });
  }
  return { client, lastUsed: Date.now() };
}

/** Соединение с сервером из кеша или новое; сбой запуска не кешируется. */
async function connectionFor(cwd: string, def: import("../types").McpServerDef): Promise<ManagedConnection> {
  const key = connectionKey(cwd, def.name);
  const existing = connections.get(key);
  if (existing) {
    const held = await existing;
    held.lastUsed = Date.now();
    return held;
  }
  const started = openConnection(cwd, def).catch((error) => {
    connections.delete(key);
    throw error;
  });
  connections.set(key, started);
  const held = await started;
  held.lastUsed = Date.now();
  return held;
}

/* ------------------------------- инструменты серверов ------------------------------- */

/** Инструмент сервера в общем пространстве имён агентного цикла. */
export interface McpToolDef {
  server: string;
  name: string;
  /** Полное имя в пространстве цикла: mcp__<server>__<tool>. */
  qualifiedName: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Текст результата вызова MCP: текстовые блоки склеиваются, остальные типы помечаются. */
function resultToText(content: unknown): string {
  const items = Array.isArray(content) ? content : [];
  const lines = items.map((item) => {
    const record = item as { type?: string; text?: unknown };
    if (record?.type === "text" && typeof record.text === "string") return record.text;
    return "[блок типа " + String((item as { type?: string })?.type ?? "неизвестный") + "]";
  });
  return capToolOutput(lines.join("\n") || "(пустой результат)");
}

/** Список инструментов серверов; недоступный сервер даёт пустой список с текстом ошибки. */
export async function listMcpTools(opts: { cwd: string; servers: import("../types").McpServerDef[] }): Promise<Array<{ server: string; tools: McpToolDef[]; error?: string }>> {
  const out: Array<{ server: string; tools: McpToolDef[]; error?: string }> = [];
  for (const def of opts.servers) {
    try {
      const connection = await connectionFor(opts.cwd, def);
      const tools: McpToolDef[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await connection.client.listTools({ cursor }, { timeout: CALL_TIMEOUT_MS });
        for (const tool of page.tools) {
          const schema = (tool.inputSchema ?? {}) as Record<string, unknown>;
          tools.push({
            server: def.name,
            name: tool.name,
            qualifiedName: mcpQualifiedName(def.name, tool.name),
            description: tool.description ?? "",
            parameters: { type: "object", ...schema },
          });
        }
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      out.push({ server: def.name, tools });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.push({ server: def.name, tools: [], error: message });
    }
  }
  return out;
}

/** Вызов инструмента сервера по полному имени; ошибка - результат ok:false для модели. */
export async function callMcpTool(opts: {
  cwd: string;
  servers: import("../types").McpServerDef[];
  qualifiedName: string;
  args: unknown;
}): Promise<{ ok: boolean; output: string }> {
  const parsed = parseMcpQualifiedName(opts.qualifiedName);
  if (!parsed) return { ok: false, output: "имя не из пространства MCP: " + opts.qualifiedName };
  const def = opts.servers.find((server) => server.name === parsed.server);
  if (!def) return { ok: false, output: "MCP-сервер не подключён: " + parsed.server };
  try {
    const connection = await connectionFor(opts.cwd, def);
    const result = await connection.client.callTool({ name: parsed.tool, arguments: (opts.args ?? {}) as Record<string, unknown> }, undefined, { timeout: CALL_TIMEOUT_MS });
    const text = resultToText(result.content);
    return { ok: !(result as { isError?: boolean }).isError, output: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: "вызов MCP-инструмента не выполнен (" + parsed.server + "/" + parsed.tool + "): " + message };
  }
}
