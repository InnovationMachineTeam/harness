import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Конфигурация собственного MCP-сервера harness (.agents/console/mcp-server.json,
 * вне Git). Определяет, какие группы инструментов и какие рабочие папки сервер
 * экспонирует; файл перечитывается при обновлении набора инструментов.
 */

/** Группы инструментов; ключи совпадают с секцией groups конфига. */
export const MCP_TOOL_GROUPS = ["prompts", "workflows", "routines", "catalog", "sessions", "monitoring", "knowledge"] as const;
export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

export interface HarnessMcpConfig {
  /** Экспонируемые рабочие папки: "all" - все из state.workspaces, иначе список абсолютных путей (подмножество). */
  workspaces: "all" | string[];
  /** Включённые группы инструментов. */
  groups: Record<McpToolGroup, boolean>;
  monitoring: {
    /** Разрешить инструмент stop_process (останавливает процессы по PID). */
    stopProcesses: boolean;
  };
  workflowTools: {
    /** Каждый workflow экспонированных папок - отдельный инструмент workflow_<id>. */
    enabled: boolean;
    /** "all" или allowlist идентификаторов workflow. */
    workflows: "all" | string[];
  };
}

export function harnessMcpConfigPath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "mcp-server.json");
}

export function defaultHarnessMcpConfig(): HarnessMcpConfig {
  return {
    workspaces: "all",
    groups: {
      prompts: true,
      workflows: true,
      routines: true,
      catalog: true,
      sessions: true,
      monitoring: false,
      knowledge: true,
    },
    monitoring: { stopProcesses: false },
    workflowTools: { enabled: true, workflows: "all" },
  };
}

/** Разбор значения файла: неизвестные ключи игнорируются, невалидные значения заменяются значением по умолчанию. */
export function parseHarnessMcpConfig(raw: unknown): HarnessMcpConfig {
  const config = defaultHarnessMcpConfig();
  if (typeof raw !== "object" || raw === null) return config;
  const record = raw as Record<string, unknown>;
  if (record.workspaces === "all") {
    config.workspaces = "all";
  } else if (Array.isArray(record.workspaces)) {
    const dirs = record.workspaces.filter((item): item is string => typeof item === "string" && item.startsWith("/"));
    if (dirs.length) config.workspaces = dirs;
  }
  if (typeof record.groups === "object" && record.groups !== null) {
    for (const group of MCP_TOOL_GROUPS) {
      const value = (record.groups as Record<string, unknown>)[group];
      if (typeof value === "boolean") config.groups[group] = value;
    }
  }
  if (typeof record.monitoring === "object" && record.monitoring !== null) {
    const stop = (record.monitoring as Record<string, unknown>).stopProcesses;
    if (typeof stop === "boolean") config.monitoring.stopProcesses = stop;
  }
  if (typeof record.workflowTools === "object" && record.workflowTools !== null) {
    const workflowTools = record.workflowTools as Record<string, unknown>;
    if (typeof workflowTools.enabled === "boolean") config.workflowTools.enabled = workflowTools.enabled;
    if (workflowTools.workflows === "all") {
      config.workflowTools.workflows = "all";
    } else if (Array.isArray(workflowTools.workflows)) {
      const ids = workflowTools.workflows.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (ids.length) config.workflowTools.workflows = ids;
    }
  }
  return config;
}

/**
 * Загрузка конфигурации: файл поверх значений по умолчанию, затем env-переопределения
 * (per-runtime профили через env транспорта в реестре MCP):
 * - HARNESS_MCP_GROUPS="prompts,catalog" - включены только перечисленные группы;
 * - HARNESS_MCP_WORKSPACES="all" или список абсолютных путей через запятую.
 */
export async function loadHarnessMcpConfig(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): Promise<HarnessMcpConfig> {
  let config = defaultHarnessMcpConfig();
  try {
    config = parseHarnessMcpConfig(JSON.parse(await readFile(harnessMcpConfigPath(repoRoot), "utf8")));
  } catch {
    /* файла нет или он невалиден - действуют значения по умолчанию */
  }
  const groupsEnv = env.HARNESS_MCP_GROUPS?.trim();
  if (groupsEnv) {
    const listed = new Set(groupsEnv.split(",").map((item) => item.trim()).filter(Boolean));
    for (const group of MCP_TOOL_GROUPS) config.groups[group] = listed.has(group);
  }
  const workspacesEnv = env.HARNESS_MCP_WORKSPACES?.trim();
  if (workspacesEnv === "all") {
    config.workspaces = "all";
  } else if (workspacesEnv) {
    const dirs = workspacesEnv.split(",").map((item) => item.trim()).filter((item) => item.startsWith("/"));
    if (dirs.length) config.workspaces = dirs;
  }
  return config;
}

/** Атомарная запись конфига (tmp + rename, как у state.json). */
export async function saveHarnessMcpConfig(repoRoot: string, config: HarnessMcpConfig): Promise<void> {
  const file = harnessMcpConfigPath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** Папки, экспонируемые конфигом: пересечение списка конфига с рабочими папками состояния. */
export function exposedWorkspaces(config: HarnessMcpConfig, stateWorkspaces: string[]): string[] {
  if (config.workspaces === "all") return stateWorkspaces;
  const allowed = new Set(config.workspaces.map((dir) => path.resolve(dir)));
  return stateWorkspaces.filter((dir) => allowed.has(path.resolve(dir)));
}
