import { createConnection } from "node:net";
import { SILENT, type HookInput, type HookOutcome } from "../lib/hook-io";

const PROBE_TIMEOUT_MS = 400;

/** TCP-проба порта сервиса памяти (соединение без HTTP-запроса). */
function probePort(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createConnection({ port, host: "127.0.0.1" });
    const finish = (ok: boolean) => {
      probe.destroy();
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    probe.once("connect", () => finish(true));
    probe.once("error", () => finish(false));
  });
}

/**
 * M-1: один раз за сессию сообщает, какие сервисы памяти (Знание → Связки)
 * отвечают и как ими пользоваться. Молчит, когда ни один не отвечает.
 */
export async function memorySessionStart(_root: string, _raw: string, _input: HookInput): Promise<HookOutcome> {
  const [lightrag, qdrant, neo4j] = await Promise.all([probePort(9621), probePort(6333), probePort(7474)]);
  const up: string[] = [];
  if (lightrag) up.push('LightRAG :9621 (docs RAG; query: bash tooling/scripts/tool.sh lightrag-query "<вопрос>")');
  if (qdrant) up.push("Qdrant :6333 (semantic fact memory; MCP mcp__qdrant__qdrant-find / qdrant-store)");
  if (neo4j) up.push("Neo4j :7474 (knowledge graph; MCP mcp__neo4j-memory__search_nodes / read_graph / create_entities / add_observations)");
  if (up.length === 0) return SILENT;
  return {
    output: `Memory services reachable: ${up.join("; ")}.`,
    fired: true,
    childExit: 0,
  };
}
