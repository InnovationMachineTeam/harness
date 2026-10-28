import path from "node:path";
import type { McpTransport } from "@/core/types";
import type { McpPreset } from "@/core/plugins";
import type { ConsoleState } from "@/core/state";

/**
 * Регистрация собственного MCP-сервера harness в реестре консоли
 * (state.mcp.servers): stdio-запись для спавна рантаймами и http-запись
 * endpoint'а консоли. Managed-синк (core/mcp/sync.ts) разносит записи в
 * нативные конфиги рантаймов без изменений.
 */

/** Имя stdio-записи реестра. */
export const HARNESS_MCP_SERVER_NAME = "harness";
/** Имя http-записи реестра (endpoint консоли). */
export const HARNESS_MCP_HTTP_NAME = "harness-http";
/** Порт инстанса консоли, на котором слушает HTTP-транспорт. */
export const HARNESS_MCP_HTTP_PORT = 3000;

/** Транспорт stdio: спавн `bun <index.ts>` с якорем корня (работает из любого cwd). */
export function harnessStdioTransport(repoRoot: string): McpTransport {
  return {
    type: "stdio",
    command: "bun",
    args: [path.join(repoRoot, "apps", "console", "src", "mcp-server", "index.ts")],
    env: { HARNESS_ROOT: repoRoot },
  };
}

/** Транспорт http: endpoint консоли с авторизацией Bearer. */
export function harnessHttpTransport(token: string): McpTransport {
  return {
    type: "http",
    url: `http://127.0.0.1:${HARNESS_MCP_HTTP_PORT}/api/mcp/harness`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/** Пресет каталога MCP (/api/mcp/catalog): собственный сервер harness. */
export function harnessMcpPreset(repoRoot: string): McpPreset {
  return {
    name: HARNESS_MCP_SERVER_NAME,
    displayName: "Harness",
    description:
      "Собственный MCP-сервер harness: запуск промтов и workflow, рутины, каталог рабочих папок (роли, навыки, workflow), сессии, мониторинг и знания платформы. " +
      "Состав инструментов настраивается (Настройки - MCP - сервер harness).",
    transport: harnessStdioTransport(repoRoot),
  };
}

/**
 * Применить состояние регистрации к state.mcp.servers (вызывает маршрут
 * /api/mcp-server перед синком): stdio - запись/удаление harness, http -
 * запись harness-http при включении и удаление при выключении.
 */
export function applyHarnessMcpRegistration(
  state: ConsoleState,
  repoRoot: string,
  opts: { stdio?: boolean; http?: { enabled: boolean; token: string } | null },
): void {
  if (opts.stdio === true) {
    state.mcp.servers[HARNESS_MCP_SERVER_NAME] = {
      name: HARNESS_MCP_SERVER_NAME,
      transport: harnessStdioTransport(repoRoot),
      enabled: true,
    };
  } else if (opts.stdio === false) {
    delete state.mcp.servers[HARNESS_MCP_SERVER_NAME];
  }
  if (opts.http?.enabled) {
    state.mcp.servers[HARNESS_MCP_HTTP_NAME] = {
      name: HARNESS_MCP_HTTP_NAME,
      transport: harnessHttpTransport(opts.http.token),
      enabled: true,
    };
  } else {
    delete state.mcp.servers[HARNESS_MCP_HTTP_NAME];
  }
}
