import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ConsoleState, InstalledTool, PackageManager, ToolInstallParams } from "./state";
import { workspaceDirs } from "./state";
import type { McpTransport } from "./types";
import { serenaTool } from "./tools/serena";
import { qmdTool } from "./tools/qmd";
import { codegraphTool } from "./tools/codegraph";
import { graphifyTool } from "./tools/graphify";
import { rtkTool } from "./tools/rtk";
import { headroomTool } from "./tools/headroom";
import { openwikiTool } from "./tools/openwiki";

/**
 * Реестр инструментов экономии контекста (Serena, qmd, CodeGraph, Graphify,
 * RTK, Headroom, OpenWiki). Управление - раздел "Настройки → Инструменты"
 * (API /api/tools/*): установка/удаление per-runtime, вкл/выкл, переустановка.
 * Системные пакеты ставятся выбранным менеджером (bun add -g / npm i -g -
 * выбор в setup.sh, файл .agents/console/package-manager.json).
 *
 * Правило поддержки (AGENTS.md §10): новый внешний инструмент - добавить
 * сюда, в tooling/scripts/tool.sh, setup.sh и docs/tools.md той же серией
 * коммитов.
 */

/** Рантаймы harness (совпадает с чипами McpPanel). */
export const TOOL_RUNTIMES = ["claude", "codex", "zcode", "cursor", "kimi", "opencode"] as const;
export type ToolRuntimeId = (typeof TOOL_RUNTIMES)[number];

/** Параметр модалки установки. */
export interface ToolParamDef {
  key: keyof ToolInstallParams;
  label: string;
  hint?: string;
  /** Для каких рантаймов имеет смысл (undefined - для всех). */
  runtimes?: ToolRuntimeId[];
}

/**
 * Инициализация и обновление проекта (Serena/CodeGraph/Graphify): кнопки
 * "Инициализировать"/"Переинициализировать" в карточке, шаги в
 * install-цепочке и обновление в husky pre-commit. Команды строятся
 * для КАЖДОЙ рабочей папки (dir) - общий контекст из всех директорий;
 * cwd шага = папка, артефакты пишутся в <dir>/… и не перезатирают друг друга.
 */
export interface ToolProjectInit {
  /** Первая инициализация папки (создаёт индекс/конфиг). */
  init(dir: string): string[][];
  /**
   * Переинициализация поверх существующей (пересборка индекса/графа).
   * Если не задана - после init кнопка не показывается.
   */
  reinit(dir: string): string[][];
  /** Быстрое обновление (husky pre-commit; секунды, не минуты). */
  update(dir: string): string[][];
  /** Артефакт инициализации внутри папки. */
  initMarker(dir: string): string | null;
}

export interface ToolPerRuntime {
  supported: ToolRuntimeId[];
  installCommand(runtime: ToolRuntimeId, params: ToolInstallParams): string[];
  uninstallCommand(runtime: ToolRuntimeId): string[];
  /**
   * Интеграция - запуск долгоживущего сервиса (installCommand = сервис,
   * например headroom proxy): шаг выполняется detached и не ждёт завершения.
   */
  detachedInstall?: boolean;
  /**
   * Маркеры установленности (детект внешних/ручных установок); опционально.
   * Несколько путей = установлен, если существует хотя бы один (например,
   * project- и global-варианты интеграции).
   */
  markerFile?(runtime: ToolRuntimeId, home: string, repoRoot: string): string | string[] | null;
  /** Примечания к неподдерживаемым рантаймам. */
  notes?: Partial<Record<ToolRuntimeId, string>>;
  params?: ToolParamDef[];
}

export interface ToolDef {
  id: string;
  title: string;
  /** 1-2 строки для карточки настроек. */
  description: string;
  docsUrl?: string;
  category: "code" | "graph" | "search" | "context";
  /** CLI-бинарник для детекта (`which`). */
  bin: string;
  /** Системный пакет; PM-зависимые учитывают packageManager. null - только вручную. */
  systemInstall(pm: PackageManager, platform: NodeJS.Platform): string[] | null;
  /** Системная зависимость (ставится перед основным пакетом, если нет). */
  requires?: { bin: string; installCommand(platform: NodeJS.Platform): string[] | null };
  /** MCP-пресет (может зависеть от параметров - headroom: режим mcp). */
  mcpPreset?(params: ToolInstallParams): McpTransport | null;
  perRuntime?: ToolPerRuntime;
  /** Установка требует выбора режима (headroom: wrap/mcp). */
  hasModes?: boolean;
  /** Инициализация/обновление проекта (кнопка + install при project-scope + pre-commit). */
  projectInit?: ToolProjectInit;
  /**
   * Долгоживущий сервис инструмента (detached-шаг установки) - для
   * инструментов с дашбордом, но без per-runtime интеграций (headroom:
   * прокси). Держится в синхроне с спавн-switch в core/dashboards.ts.
   */
  dashboardCommand?: string[];
  /**
   * Uninstall такого инструмента останавливает его автономный инстанс
   * (dashboards.json) и сбрасывает autostart.
   */
  uninstallStopsDashboard?: boolean;
  /** Дополнительные шаги после установки (qmd: индексация рабочих папок). */
  postInstallCommands?(state: ConsoleState, params: ToolInstallParams): string[][];
  /** Локальный веб-дашборд (iframe из браузера; серверных запросов нет). */
  dashboard?: {
    url: string;
    label: string;
    /**
     * Same-origin путь для iframe (embed-прокси /dashboard/*) - для сервисов,
     * запрещающих встраивание заголовком x-frame-options (headroom).
     * Прямой url остаётся для "открыть в новой вкладке".
     */
    embedPath?: string;
  };
}

/* ------------------------------ выбор менеджера ----------------------------- */

export function packageManagerFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "package-manager.json");
}

export async function readPackageManagerPref(repoRoot: string): Promise<PackageManager> {
  try {
    const raw = JSON.parse(await readFile(packageManagerFilePath(repoRoot), "utf8")) as {
      packageManager?: unknown;
    };
    return raw.packageManager === "npm" ? "npm" : "bun";
  } catch {
    return "bun";
  }
}

export async function writePackageManagerPref(repoRoot: string, pm: PackageManager): Promise<void> {
  const file = packageManagerFilePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ packageManager: pm }, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** Команда глобальной установки npm-пакета выбранным менеджером. */
export function globalInstallCommand(pm: PackageManager, pkg: string): string[] {
  return pm === "bun" ? ["bun", "add", "-g", pkg] : ["npm", "install", "-g", pkg];
}

/* --------------------------------- реестр ----------------------------------- */
/* Инструменты оформлены как плагины (по модулю на инструмент, src/core/tools/):
 * новый инструмент = новый модуль с ToolDef + строка в списке ниже.
 * Как написать плагин - docs/tools-dev.md. */

export const TOOLS: ToolDef[] = [
  serenaTool,
  qmdTool,
  codegraphTool,
  graphifyTool,
  rtkTool,
  headroomTool,
  openwikiTool,
];

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/* -------------------------------- детекция ---------------------------------- */

const cliCache = new Map<string, { at: number; installed: boolean; version: string | null }>();

/** Сброс кешей CLI-детекта (тесты). */
export function resetToolCaches(): void {
  cliCache.clear();
}

/** Установлен ли бинарник в PATH (`which <bin>`; bin - литерал из реестра). */
export function detectToolCli(bin: string): { installed: boolean; version: string | null } {
  const cached = cliCache.get(bin);
  if (cached && Date.now() - cached.at < 60_000) return { installed: cached.installed, version: cached.version };
  const which = spawnSync("which", [bin], { encoding: "utf8", timeout: 3000 });
  const installed = which.status === 0 && which.stdout.trim().length > 0;
  const version = installed ? toolVersion(bin) : null;
  cliCache.set(bin, { at: Date.now(), installed, version });
  return { installed, version };
}

/** Версия инструмента - литеральный allowlist команд (как спавн-allowlist prompts.ts). */
function toolVersion(bin: string): string | null {
  const res = (() => {
    switch (bin) {
      case "serena":
        return spawnSync("serena", ["--version"], { encoding: "utf8", timeout: 3000 });
      case "qmd":
        return spawnSync("qmd", ["--version"], { encoding: "utf8", timeout: 3000 });
      case "codegraph":
        return spawnSync("codegraph", ["--version"], { encoding: "utf8", timeout: 3000 });
      case "graphify":
        return spawnSync("graphify", ["--version"], { encoding: "utf8", timeout: 3000 });
      case "rtk":
        return spawnSync("rtk", ["--version"], { encoding: "utf8", timeout: 3000 });
      case "headroom":
        return spawnSync("headroom", ["--version"], { encoding: "utf8", timeout: 3000 });
      default:
        return null; // openwiki: --version нет, версия читается из package.json ниже
    }
  })();
  if (res && res.status === 0 && res.stdout.trim()) return res.stdout.trim().split("\n")[0];
  if (bin === "openwiki") return openwikiVersionFromPackageJson();
  return null;
}

/**
 * Версия openwiki из package.json глобальной установки (у CLI нет --version):
 * npm root -g → <dir>/openwiki/package.json, фолбэк - глобальный bun.
 */
function openwikiVersionFromPackageJson(): string | null {
  const candidates: string[] = [];
  const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 3000 });
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    candidates.push(path.join(npmRoot.stdout.trim(), "openwiki", "package.json"));
  }
  candidates.push(path.join(homedir(), ".bun", "install", "global", "node_modules", "openwiki", "package.json"));
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version) return `openwiki ${pkg.version}`;
    } catch {
      /* следующий кандидат */
    }
  }
  return null;
}

/** Установлена ли per-runtime интеграция (консольная запись или файловый маркер). */
export function toolRuntimeInstalled(
  def: ToolDef,
  runtime: ToolRuntimeId,
  home: string,
  repoRoot: string,
  state: ConsoleState,
): boolean {
  if (state.tools.installed[def.id]?.runtimes.includes(runtime)) return true;
  const marker = def.perRuntime?.markerFile?.(runtime, home, repoRoot);
  const paths = marker == null ? [] : Array.isArray(marker) ? marker : [marker];
  return paths.some((p) => existsSync(p));
}

export type ToolState = "missing" | "on" | "off";

/**
 * Эффективное состояние инструмента: запись консоли (enabled) → маркеры на
 * диске / MCP-реестр → missing. Системный пакет (bin) учитывается отдельно -
 * см. detectToolCli.
 */
export function effectiveToolState(def: ToolDef, state: ConsoleState, home: string, repoRoot: string): ToolState {
  const record = state.tools.installed[def.id];
  if (record) return record.enabled ? "on" : "off";
  if (def.perRuntime) {
    const anyInstalled = def.perRuntime.supported.some((runtime) =>
      toolRuntimeInstalled(def, runtime, home, repoRoot, state),
    );
    if (anyInstalled) return "on";
  }
  const server = state.mcp.servers[def.id];
  if (server) return server.enabled ? "on" : "off";
  return "missing";
}

/* ------------------------------ tools.env (tool.sh) ------------------------- */

export function toolsEnvPath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "tools.env");
}

/**
 * Записать плоское состояние инструментов для диспетчера
 * tooling/scripts/tool.sh: TOOL_<ID>=on|off (нет строки - не установлен,
 * скрипт тогда сам проверяет which). Вызывается после мутаций и в GET /api/tools.
 */
export async function writeToolsEnv(repoRoot: string, state: ConsoleState): Promise<void> {
  const home = homedir();
  const lines: string[] = [
    "# Пишется консолью; править вручную не нужно.",
    "# TOOL_<ID>=on|off; отсутствие строки = не установлен.",
  ];
  for (const def of TOOLS) {
    if (def.id === "openwiki") continue; // не входит в диспетчер (управление - вкладка "Память")
    const st = effectiveToolState(def, state, home, repoRoot);
    if (st !== "missing") lines.push(`TOOL_${def.id.toUpperCase()}=${st === "on" ? "on" : "off"}`);
  }
  const file = toolsEnvPath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${lines.join("\n")}\n`, "utf8");
  await rename(tmp, file);
}

/** Читаемое состояние для UI (GET /api/tools). */
export interface ToolStatusDTO {
  id: string;
  title: string;
  description: string;
  docsUrl?: string;
  category: ToolDef["category"];
  system: { installed: boolean; version: string | null; installCommand: string[] | null };
  state: ToolState;
  perRuntime?: {
    supported: { id: ToolRuntimeId; installed: boolean; note?: string }[];
    /** Рантаймы, не поддерживаемые инструментом (с примечанием для UI). */
    unsupported: { id: ToolRuntimeId; note?: string }[];
  };
  paramDefs: { key: keyof ToolInstallParams; label: string; hint?: string; runtimes?: ToolRuntimeId[] }[];
  mcp: { registered: boolean; enabled: boolean } | null;
  hasModes: boolean;
  /**
   * Инициализация проекта по рабочим папкам: initialized - все папки
   * проинициализированы; dirs - состояние каждой.
   */
  projectInit?: {
    initialized: boolean;
    initCommands: string[][];
    reinitCommands: string[][];
    dirs: { dir: string; initialized: boolean }[];
  };
  installedRecord: InstalledTool | null;
  dashboard?: {
    url: string;
    label: string;
    embedPath?: string;
    live: boolean;
    managedPid: number | null;
    autostart: boolean;
  };
}

/** Доступность дашбордов инструментов (TCP-проба; вызывается из GET /api/tools). */
export async function probeDashboards(
  repoRoot: string,
  state: ConsoleState,
): Promise<Record<string, { live: boolean; managedPid: number | null; autostart: boolean }>> {
  const { probePort, dashboardManagedPid } = await import("./dashboards");
  const result: Record<string, { live: boolean; managedPid: number | null; autostart: boolean }> = {};
  for (const def of TOOLS) {
    if (!def.dashboard) continue;
    const port = (() => {
      try {
        const parsed = new URL(def.dashboard!.url);
        const n = Number.parseInt(parsed.port, 10);
        return Number.isInteger(n) ? n : null;
      } catch {
        return null;
      }
    })();
    result[def.id] = {
      live: port ? await probePort(port) : false,
      managedPid: await dashboardManagedPid(repoRoot, def.id),
      autostart: state.tools.autostart[def.id] === true,
    };
  }
  return result;
}

export async function toolsStatus(
  repoRoot: string,
  state: ConsoleState,
  pm: PackageManager,
): Promise<ToolStatusDTO[]> {
  const home = homedir();
  const platform = process.platform as NodeJS.Platform;
  const dashboards = await probeDashboards(repoRoot, state);
  return TOOLS.map((def): ToolStatusDTO => {
    const cli = detectToolCli(def.bin);
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      docsUrl: def.docsUrl,
      category: def.category,
      system: { installed: cli.installed, version: cli.version, installCommand: def.systemInstall(pm, platform) },
      state: effectiveToolState(def, state, home, repoRoot),
      perRuntime: def.perRuntime
        ? {
            supported: def.perRuntime.supported.map((runtime) => ({
              id: runtime,
              installed: toolRuntimeInstalled(def, runtime, home, repoRoot, state),
              note: def.perRuntime?.notes?.[runtime],
            })),
            unsupported: TOOL_RUNTIMES.filter((r) => !def.perRuntime?.supported.includes(r)).map((runtime) => ({
              id: runtime,
              note: def.perRuntime?.notes?.[runtime] ?? "не поддерживается инструментом",
            })),
          }
        : undefined,
      paramDefs: (def.perRuntime?.params ?? []).map((p) => ({
        key: p.key,
        label: p.label,
        hint: p.hint,
        runtimes: p.runtimes,
      })),
      mcp: state.mcp.servers[def.id]
        ? { registered: true, enabled: state.mcp.servers[def.id].enabled }
        : def.mcpPreset
          ? { registered: false, enabled: false }
          : null,
      hasModes: def.hasModes ?? false,
      projectInit: def.projectInit
        ? (() => {
            const dirs = workspaceDirs(state).map((dir) => ({
              dir,
              initialized: (() => {
                const marker = def.projectInit!.initMarker(dir);
                return marker ? existsSync(marker) : false;
              })(),
            }));
            return {
              initialized: dirs.length > 0 && dirs.every((d) => d.initialized),
              initCommands: def.projectInit.init(dirs[0]?.dir ?? repoRoot),
              reinitCommands: def.projectInit.reinit?.(dirs[0]?.dir ?? repoRoot) ?? [],
              dirs,
            };
          })()
        : undefined,
      installedRecord: state.tools.installed[def.id] ?? null,
      dashboard: def.dashboard ? { ...def.dashboard, ...dashboards[def.id] } : undefined,
    };
  });
}
