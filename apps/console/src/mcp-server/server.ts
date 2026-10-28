import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHarnessActions, type HarnessMcpActions } from "./actions";
import { loadHarnessMcpConfig, type HarnessMcpConfig } from "./config";
import { buildPromptTools } from "./tools/prompts";
import { buildWorkflowTools } from "./tools/workflows";
import { buildRoutineTools } from "./tools/routines";
import { buildCatalogTools } from "./tools/catalog";
import { buildSessionTools } from "./tools/sessions";
import { buildMonitoringTools } from "./tools/monitoring";
import { buildKnowledgeTools } from "./tools/knowledge";
import { buildDynamicWorkflowTools } from "./tools/dynamic";
import { stringifyToolResult, type ToolSpec } from "./tools/types";

/**
 * Сборка MCP-сервера harness: общий сборщик инструментария для обоих входов
 * (stdio-процесс и HTTP-роут консоли). Набор инструментов пересобирается из
 * конфига и каталогов рабочих папок фоновым тиком; изменения применяются на
 * живом соединении (register/enable/disable + уведомление toolListChanged).
 */

export const HARNESS_MCP_SERVER_INFO = { name: "harness", version: "1.0.0" } as const;

/** Интервал фонового пересбора набора инструментов. */
const REFRESH_INTERVAL_MS = 15_000;

/** Полный набор инструментов по конфигу: группы + динамические workflow-инструменты. */
export async function collectHarnessToolSpecs(
  config: HarnessMcpConfig,
  actions: HarnessMcpActions,
  repoRoot: string,
): Promise<ToolSpec[]> {
  const specs: ToolSpec[] = [];
  if (config.groups.prompts) specs.push(...buildPromptTools(actions));
  if (config.groups.workflows) specs.push(...buildWorkflowTools(actions));
  if (config.groups.routines) specs.push(...buildRoutineTools(actions));
  if (config.groups.catalog) specs.push(...buildCatalogTools(actions));
  if (config.groups.sessions) specs.push(...buildSessionTools(actions));
  if (config.groups.monitoring) specs.push(...buildMonitoringTools(actions, config));
  if (config.groups.knowledge) specs.push(...buildKnowledgeTools(actions));
  specs.push(...(await buildDynamicWorkflowTools(config, actions, repoRoot)));
  return specs;
}

/** Регистрация инструмента на сервере: результат - текст (JSON с отсечением по объёму), ошибка - isError. */
function registerToolSpec(server: McpServer, spec: ToolSpec): RegisteredTool {
  return server.registerTool(
    spec.name,
    { description: spec.description, inputSchema: spec.schema },
    async (args: unknown) => {
      try {
        return { content: [{ type: "text" as const, text: stringifyToolResult(await spec.handler(args)) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `ошибка: ${message}` }], isError: true };
      }
    },
  );
}

export interface HarnessMcpServer {
  server: McpServer;
  /** Однократный пересбор набора (конфиг перечитывается с диска). */
  refresh(): Promise<void>;
  /** Останов фонового пересбора. */
  stop(): void;
}

export async function buildHarnessMcpServer(opts: {
  repoRoot: string;
  /** Конфиг первого сборки; по умолчанию читается с диска. */
  config?: HarnessMcpConfig;
  /** Подмена действий (тесты); по умолчанию действия над реальным репозиторием. */
  actions?: HarnessMcpActions;
}): Promise<HarnessMcpServer> {
  const { repoRoot } = opts;
  const actions = opts.actions ?? createHarnessActions();
  const server = new McpServer(HARNESS_MCP_SERVER_INFO);
  const registered = new Map<string, RegisteredTool>();

  const apply = async (specs: ToolSpec[]): Promise<void> => {
    const names = new Set(specs.map((spec) => spec.name));
    let changed = false;
    for (const spec of specs) {
      const existing = registered.get(spec.name);
      if (existing) {
        if (!existing.enabled) {
          existing.enable();
          changed = true;
        }
        existing.update({ description: spec.description, paramsSchema: spec.schema as never });
      } else {
        registered.set(spec.name, registerToolSpec(server, spec));
        changed = true;
      }
    }
    for (const [name, tool] of registered) {
      if (!names.has(name) && tool.enabled) {
        tool.disable();
        changed = true;
      }
    }
    if (changed) server.sendToolListChanged();
  };

  const initialConfig = opts.config ?? (await loadHarnessMcpConfig(repoRoot));
  await apply(await collectHarnessToolSpecs(initialConfig, actions, repoRoot));

  let running = false;
  const refresh = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const config = await loadHarnessMcpConfig(repoRoot);
      await apply(await collectHarnessToolSpecs(config, actions, repoRoot));
    } catch {
      /* пересбор пропускается: следующий тик повторит */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  timer.unref?.();

  return { server, refresh, stop: () => clearInterval(timer) };
}
