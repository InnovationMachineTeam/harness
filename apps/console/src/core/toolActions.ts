import { detectToolCli, type ToolDef, type ToolRuntimeId } from "./tools";
import type { ConsoleState, PackageManager, ToolInstallParams } from "./state";
import { workspaceDirs } from "./state";
import { graphifyWorkspaceNames } from "./graphify";
import type { ToolJobStep } from "./toolJobs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Построение цепочек шагов (core/toolJobs.ts) для жизненного цикла
 * инструментов: install / uninstall / reinstall / toggle. Используется и для
 * dryRun-превью команд в модалке установки. Все команды - литеральные
 * массивы аргументов из реестра core/tools.ts; оболочка не привлекается.
 */

export type StepsResult = { ok: true; steps: ToolJobStep[] } | { ok: false; error: string };

/** Санитайз параметров установки (вход - JSON из API). Проектная область - значение по умолчанию. */
export function sanitizeToolParams(input: unknown): ToolInstallParams {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    scope: raw.scope === "global" ? "global" : "project",
    ...(raw.strict === true ? { strict: true } : {}),
    ...(raw.indexWorkspaces === true ? { indexWorkspaces: true } : {}),
    mode: raw.mode === "mcp" ? "mcp" : "wrap",
  };
}

/** Рантаймы в пределах поддерживаемых инструментом (пустой ввод - все). */
export function sanitizeRuntimes(def: ToolDef, input: unknown): ToolRuntimeId[] {
  const supported = def.perRuntime?.supported ?? [];
  if (!Array.isArray(input)) return [...supported];
  const wanted = input.filter(
    (r): r is ToolRuntimeId => typeof r === "string" && supported.includes(r as ToolRuntimeId),
  );
  return wanted.length > 0 ? wanted : [...supported];
}

export function buildInstallSteps(opts: {
  def: ToolDef;
  runtimes: ToolRuntimeId[];
  params: ToolInstallParams;
  platform: NodeJS.Platform;
  packageManager: PackageManager;
  state: ConsoleState;
  repoRoot: string;
}): StepsResult {
  const { def, runtimes, params, platform, packageManager, state, repoRoot } = opts;
  const steps: ToolJobStep[] = [];

  if (def.requires && !detectToolCli(def.requires.bin).installed) {
    const cmd = def.requires.installCommand(platform);
    if (!cmd) {
      return {
        ok: false,
        error: `требуется ${def.requires.bin} - установите вручную (macOS: brew install ${def.requires.bin})`,
      };
    }
    steps.push({ label: `Зависимость: ${def.requires.bin}`, command: cmd });
  }

  if (!detectToolCli(def.bin).installed) {
    const cmd = def.systemInstall(packageManager, platform);
    if (!cmd) {
      return { ok: false, error: "установка системного пакета на этой платформе - вручную (см. docs/tools.md)" };
    }
    steps.push({ label: `Системный пакет: ${def.title}`, command: cmd });
  }

  const useMcpMode = def.hasModes && params.mode === "mcp";
  if (useMcpMode) {
    // только регистрация MCP - per-runtime шагов нет
  } else if (def.perRuntime && (def.perRuntime.available?.() ?? true)) {
    // интеграция-сервис (headroom): один detached-шаг на всех рантаймов
    if (def.perRuntime.detachedInstall && def.dashboardCommand) {
      steps.push({ label: `Сервис: ${def.title}`, command: def.dashboardCommand, detached: true });
    }
    for (const runtime of runtimes) {
      const command = def.perRuntime.installCommand(runtime, params);
      if (command.length === 0) continue; // сервис уже запущен шагом выше
      steps.push({
        label: `Интеграция: ${runtime}`,
        command,
        ...(def.perRuntime.detachedInstall ? { detached: true } : {}),
      });
    }
  } else if (def.dashboardCommand) {
    // инструмент с долгоживущим сервисом: detached-шаг
    steps.push({ label: `Сервис: ${def.title}`, command: def.dashboardCommand, detached: true });
  }

  for (const command of def.postInstallCommands?.(state, params) ?? []) {
    steps.push({ label: "После установки", command });
  }

  // инициализация проекта (индексы/граф) - по всем рабочим папкам,
  // независимо от scope интеграции: общий контекст из всех директорий
  if (def.projectInit) {
    const dirs = workspaceDirs(state);
    const names = graphifyWorkspaceNames(dirs);
    for (const dir of dirs) {
      const name = names.get(dir) ?? path.basename(dir);
      for (const command of def.projectInit.init(dir, repoRoot, name)) {
        steps.push({ label: `Инициализация: ${def.title} · ${dir}`, command, cwd: dir });
      }
    }
  }

  return { ok: true, steps };
}

/**
 * Шаги инициализации/переинициализации по всем рабочим папкам
 * (cwd шага = папка; артефакты пишутся в <dir>/… - без взаимных перезаписей;
 * граф Graphify - исключение: <repoRoot>/graphify/<имя>/graphify-out).
 */
export function buildInitSteps(
  def: ToolDef,
  params: ToolInstallParams,
  reinit: boolean,
  dirs: string[],
  repoRoot: string,
): ToolJobStep[] {
  if (!def.projectInit || dirs.length === 0) return [];
  const names = graphifyWorkspaceNames(dirs);
  const steps: ToolJobStep[] = [];
  for (const dir of dirs) {
    const name = names.get(dir) ?? path.basename(dir);
    const commands =
      reinit && def.projectInit.reinit ? def.projectInit.reinit(dir, repoRoot, name) : def.projectInit.init(dir, repoRoot, name);
    for (const command of commands) {
      steps.push({
        label: `${reinit ? "Переинициализация" : "Инициализация"}: ${def.title} · ${dir}`,
        command,
        cwd: dir,
      });
    }
  }
  return steps;
}

export function buildUninstallSteps(opts: {
  def: ToolDef;
  runtimes: ToolRuntimeId[];
  params: ToolInstallParams;
}): ToolJobStep[] {
  const { def, runtimes, params } = opts;
  const steps: ToolJobStep[] = [];
  const useMcpMode = def.hasModes && params.mode === "mcp";
  if (!useMcpMode && def.perRuntime && (def.perRuntime.available?.() ?? true)) {
    // сервис-инструменты (headroom): остановка - программно (stopDashboard)
    if (def.uninstallStopsDashboard) return steps;
    for (const runtime of runtimes) {
      // project-интеграции RTK снимаются программно (route), CLI сам не умеет
      if (def.id === "rtk" && params.scope === "project") continue;
      steps.push({
        label: `Снятие интеграции: ${runtime}`,
        command: def.perRuntime.uninstallCommand(runtime),
        // "нечего снимать" или каприз uninstall'а не должен ломать переустановку
        optional: true,
      });
    }
  }
  return steps;
}

/**
 * Программная зачистка project-интеграций после uninstall: CLI некоторых
 * инструментов (RTK 0.39.x) не умеет снимать project-scope ("manually
 * remove RTK from CLAUDE.md") - консоль удаляет маркерные блоки и файлы сам.
 * Возвращает список выполненных действий (для терминала/usage).
 */
export async function cleanupAfterUninstall(
  repoRoot: string,
  def: ToolDef,
  params: ToolInstallParams,
): Promise<string[]> {
  const cleaned: string[] = [];
  if (def.id === "rtk" && params.scope === "project") {
    const root = path.resolve(repoRoot);
    // путь строго внутри корня репозитория: resolve + boundary-проверка
    const inside = (rel: string): string | null => {
      const target = path.resolve(root, rel);
      return target === root || target.startsWith(root + path.sep) ? target : null;
    };
    // 1) маркерные блоки инструкций в корневых CLAUDE.md / AGENTS.md
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      const filePath = inside(file);
      if (!filePath) continue;
      try {
        const text = await readFile(filePath, "utf8");
        const cleanedText = text.replace(
          /<!-- rtk-instructions[^>]*-->[\s\S]*?<!-- \/rtk-instructions -->\n?/g,
          "",
        );
        if (cleanedText !== text) {
          await writeFile(filePath, cleanedText);
          cleaned.push(`${file}: блок rtk-instructions удалён`);
        }
      } catch {
        /* файла нет - нечего чистить */
      }
    }
    // 2) файлы project-интеграций (создаются rtk init без -g)
    for (const rel of [".rtk/filters.toml", ".opencode/plugins/rtk.ts", ".claude/RTK.md"]) {
      const filePath = inside(rel);
      if (!filePath) continue;
      try {
        await rm(filePath, { force: true });
        cleaned.push(`${rel} удалён`);
      } catch {
        /* нет файла - ок */
      }
    }
  }
  return cleaned;
}
