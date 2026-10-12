import { existsSync } from "node:fs";
import type { ToolDef } from "../tools";

/**
 * Плагин инструмента Neo4j: графовая СУБД - общее хранилище связок памяти
 * ("neo4j + LightRAG", "neo4j + Qdrant"). Сервис - локальный `neo4j console`
 * (Browser :7474, Bolt :7687, только localhost); для агентов - MCP-сервер
 * mcp-neo4j-memory (knowledge graph: сущности, отношения, наблюдения).
 * Инстанс ставится brew; запускается консолью как автономный сервис.
 */

/**
 * Пароль локального инстанса (задаётся шагом установки, слушает только
 * localhost; смена - `neo4j-admin dbms set-initial-password <новый>`).
 */
export const NEO4J_LOCAL_PASSWORD = "harness-memory";

/** Признак выполненного set-initial-password (разметка brew-формулы neo4j). */
function initialPasswordSet(): boolean {
  return ["/opt/homebrew/var/neo4j/data/dbms/auth.ini", "/usr/local/var/neo4j/data/dbms/auth.ini"].some((file) =>
    existsSync(file),
  );
}

export const neo4jTool: ToolDef = {
  id: "neo4j",
  title: "Neo4j",
  description:
    "Графовая СУБД - хранилище связок памяти: knowledge graph для MCP-памяти агентов (mcp-neo4j-memory) и графового RAG (LightRAG). Сервис, Browser и Bolt - только localhost.",
  docsUrl: "https://neo4j.com/docs/",
  category: "memory",
  bin: "neo4j",
  systemInstall: (_pm, platform) => (platform === "darwin" ? ["brew", "install", "neo4j"] : null),
  systemUpdate: (_pm, platform) => (platform === "darwin" ? ["brew", "upgrade", "neo4j"] : null),
  requires: {
    // uvx нужен MCP-серверу mcp-neo4j-memory в конфигах рантаймов
    bin: "uv",
    installCommand: (platform) => (platform === "darwin" ? ["brew", "install", "uv"] : null),
  },
  postInstallCommands: () => (initialPasswordSet() ? [] : [["neo4j-admin", "dbms", "set-initial-password", NEO4J_LOCAL_PASSWORD]]),
  mcpPreset: () => ({
    type: "stdio",
    command: "uvx",
    args: ["mcp-neo4j-memory", "--transport", "stdio"],
    env: {
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: NEO4J_LOCAL_PASSWORD,
    },
  }),
  dashboard: { url: "http://127.0.0.1:7474", label: "Neo4j Browser" },
  uninstallStopsDashboard: true,
};
