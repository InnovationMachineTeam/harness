import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { ToolDef } from "../tools";

/**
 * Плагин инструмента Qdrant: векторная СУБД - хранилище связки
 * "neo4j + Qdrant". Сервис - локальный `qdrant` (REST/WebUI :6333, gRPC
 * :6334); для агентов - MCP-сервер mcp-server-qdrant (семантический поиск
 * по коллекции памяти; эмбеддинги - локальный fastembed, ключ не нужен).
 *
 * Установка macOS: официальная сборка из GitHub Releases (brew-формулы
 * qdrant нет; версия зафиксирована - при новом релизе обновите
 * QDRANT_VERSION). Бинарник - в ~/.local/opt/qdrant, симлинк - в
 * ~/.local/bin (должен быть в PATH). Бинарник из GitHub Releases не
 * содержит встроенный Web UI (он есть только в Docker-образах), поэтому
 * установка докачивает статику qdrant-web-ui и запускает её средствами
 * самого qdrant (QDRANT__SERVICE__STATIC_CONTENT_DIR, см. dashboards.ts).
 */

const QDRANT_VERSION = "1.19.2";
const WEB_UI_VERSION = "0.2.19";
const OPT_DIR = `${homedir()}/.local/opt/qdrant`;
const BIN_DIR = `${homedir()}/.local/bin`;
const BINARY = `${OPT_DIR}/qdrant`;
const LINK = `${BIN_DIR}/qdrant`;
/** Статика Web UI: её раздаёт сам qdrant по /dashboard. */
export const QDRANT_WEB_UI_DIR = `${OPT_DIR}/dist`;

function releaseAsset(): string {
  return process.arch === "arm64" ? "qdrant-aarch64-apple-darwin.tar.gz" : "qdrant-x86_64-apple-darwin.tar.gz";
}

export const qdrantTool: ToolDef = {
  id: "qdrant",
  title: "Qdrant",
  description:
    "Векторная СУБД памяти: семантический поиск для агентов через MCP (mcp-server-qdrant; эмбеддинги - локальный fastembed, API-ключ не нужен). Сервис и WebUI - только localhost.",
  docsUrl: "https://qdrant.tech/documentation/",
  category: "memory",
  bin: "qdrant",
  systemInstall: (_pm, platform) => (platform === "darwin" ? ["mkdir", "-p", OPT_DIR, BIN_DIR] : null),
  requires: {
    // uvx нужен MCP-серверу mcp-server-qdrant в конфигах рантаймов
    bin: "uv",
    installCommand: (platform) => (platform === "darwin" ? ["brew", "install", "uv"] : null),
  },
  postInstallCommands: () => {
    const url = `https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/${releaseAsset()}`;
    const archive = `${OPT_DIR}/qdrant-${QDRANT_VERSION}.tar.gz`;
    const commands: string[][] = [];
    if (!existsSync(BINARY)) {
      commands.push(["curl", "-fL", "-o", archive, url]);
      commands.push(["tar", "-xzf", archive, "-C", OPT_DIR]);
      commands.push(["ln", "-sf", BINARY, LINK]);
    }
    // Web UI: бинарник из релизов собирается без встроенной статики
    if (!existsSync(`${QDRANT_WEB_UI_DIR}/index.html`)) {
      const zip = `${OPT_DIR}/dist-qdrant.zip`;
      commands.push(["curl", "-fL", "-o", zip, `https://github.com/qdrant/qdrant-web-ui/releases/download/v${WEB_UI_VERSION}/dist-qdrant.zip`]);
      commands.push(["unzip", "-oq", zip, "-d", OPT_DIR]);
      commands.push(["rm", "-f", zip]);
    }
    return commands;
  },
  mcpPreset: () => ({
    type: "stdio",
    command: "uvx",
    args: ["mcp-server-qdrant"],
    env: {
      QDRANT_URL: "http://127.0.0.1:6333",
      COLLECTION_NAME: "harness-memory",
    },
  }),
  dashboard: { url: "http://127.0.0.1:6333/dashboard", label: "WebUI Qdrant" },
  uninstallStopsDashboard: true,
};
