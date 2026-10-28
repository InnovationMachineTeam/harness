import { existsSync } from "node:fs";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findRepoRoot } from "@/core/repo";
import { buildHarnessMcpServer } from "./server";

/**
 * Вход stdio MCP-сервера harness. Запускается рантаймами записью реестра MCP:
 * bun <repoRoot>/apps/console/src/mcp-server/index.ts с env HARNESS_ROOT
 * (без него корень ищется walk-up от cwd - работает при запуске из репозитория).
 * Протокол идёт через stdout: диагностика - только в stderr.
 */

const repoRoot = findRepoRoot();
if (!existsSync(join(repoRoot, ".agents", "runtime", "config.json"))) {
  process.stderr.write(`harness mcp: корень репозитория harness не найден (запуск из ${process.cwd()}); задайте HARNESS_ROOT\n`);
  process.exit(1);
}

const harness = await buildHarnessMcpServer({ repoRoot });
process.stderr.write(`harness mcp: сервер запущен (корень ${repoRoot})\n`);
await harness.server.connect(new StdioServerTransport());
// соединение живо, пока открыт stdin; после закрытия процесс завершается
await new Promise<void>((resolve) => {
  process.stdin.on("close", () => {
    harness.stop();
    resolve();
  });
});
