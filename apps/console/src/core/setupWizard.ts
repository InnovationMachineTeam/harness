import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ConsoleState, SetupWizardState } from "./state";
import { normalizeSetupWizard, saveConsoleState, stateFilePath } from "./state";
import type { ToolJobStep } from "./toolJobs";

/**
 * Setup Wizard первой установки (страница /setup): проверка системы, выбор
 * пакетного менеджера, установка недостающих системных компонентов (bun,
 * node) и опциональных инструментов консоли одним job'ом. Состояние визарда -
 * поле setupWizard в state.json: новая установка (файла состояния нет)
 * блокирует разделы консоли до завершения или пропуска (/setup).
 *
 * Команды установки повторяют шаги tooling/scripts/setup.sh литеральными
 * массивами аргументов (без оболочки); системные утилиты (ps, sh, which, git)
 * только проверяются. Рантаймы агентов (Claude Code, Codex, ZCode, Cursor,
 * Kimi, OpenCode, Antigravity) не устанавливаются - только детект.
 */

export type { SetupWizardState };

/**
 * Требуется ли визард: файла состояния нет (новая установка) - да; поле
 * setupWizard есть - пока done не true; файл есть без поля (установка до
 * появления визарда) - нет. Битый state.json не блокирует консоль.
 */
export function setupGateRequired(repoRoot: string): boolean {
  const file = stateFilePath(repoRoot);
  if (!existsSync(file)) return true;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { setupWizard?: unknown };
    if (!("setupWizard" in raw)) return false;
    return normalizeSetupWizard(raw.setupWizard)?.done !== true;
  } catch {
    return false;
  }
}

/**
 * Зафиксировать начало визарда: на новой установке state.json ещё нет - любая
 * операция консоли, сохраняющая состояние, сняла бы gate. Первая загрузка
 * статуса пишет поле { done: false } - gate держится до complete.
 */
export async function ensureSetupStarted(repoRoot: string, state: ConsoleState): Promise<boolean> {
  if (existsSync(stateFilePath(repoRoot))) return false;
  state.setupWizard = { done: false, completedAt: null, skippedAt: null };
  await saveConsoleState(repoRoot, state);
  return true;
}

/* --------------------------------- детект ----------------------------------- */

const probeCache = new Map<string, { installed: boolean; version: string | null }>();

/** `which <bin>` + версия литеральной командой (allowlist; вызовы статуса редки). */
function probeCli(bin: string, versionArgs: string[] | null): { installed: boolean; version: string | null } {
  const cached = probeCache.get(bin);
  if (cached) return cached;
  const which = spawnSync("which", [bin], { encoding: "utf8", timeout: 3000 });
  const installed = which.status === 0 && which.stdout.trim().length > 0;
  let version: string | null = null;
  if (installed && versionArgs) {
    const res = spawnSync(bin, versionArgs, { encoding: "utf8", timeout: 5000 });
    if (res.status === 0 && res.stdout.trim()) version = res.stdout.trim().split("\n")[0];
  }
  const result = { installed, version };
  probeCache.set(bin, result);
  return result;
}

/** Сброс кеша детекта (тесты; повторная проверка после установки). */
export function resetSetupProbeCache(): void {
  probeCache.clear();
}

export const NODE_MIN_MAJOR = 22;

/** Мажорная версия из "v22.4.0" / "22.4.0"; не число - 0. */
export function nodeMajor(version: string | null): number {
  if (!version) return 0;
  const parsed = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "", 10);
  return Number.isInteger(parsed) ? parsed : 0;
}

export interface SetupDep {
  id: "bun" | "node";
  title: string;
  /** Для чего нужен (подсказка в списке). */
  purpose: string;
  installed: boolean;
  version: string | null;
  /** Установлен и версия достаточна. */
  ok: boolean;
  minMajor: number | null;
}

export function probeSetupDeps(): SetupDep[] {
  const bun = probeCli("bun", ["--version"]);
  const node = probeCli("node", ["--version"]);
  const nodeMajorVersion = nodeMajor(node.version);
  return [
    {
      id: "bun",
      title: "bun (+bunx)",
      purpose: "менеджер пакетов, раннер скриптов, тесты, bunx skills",
      installed: bun.installed,
      version: bun.version,
      ok: bun.installed,
      minMajor: null,
    },
    {
      id: "node",
      title: `node (≥ ${NODE_MIN_MAJOR})`,
      purpose: "guard-хуки рантаймов, headless-запуск ZCode, openwiki",
      installed: node.installed,
      version: node.version,
      ok: node.installed && nodeMajorVersion >= NODE_MIN_MAJOR,
      minMajor: NODE_MIN_MAJOR,
    },
  ];
}

/** Системные утилиты: только проверяются, установки не требуют. */
export function probeSystemUtils(): { id: string; installed: boolean }[] {
  const ids = process.platform === "darwin" ? ["ps", "sh", "which", "git", "open"] : ["ps", "sh", "which", "git"];
  return ids.map((id) => ({ id, installed: probeCli(id, null).installed }));
}

/** Рантаймы агентов: детект для сведений; установку выполняет пользователь. */
export const AGENT_RUNTIMES: { id: string; title: string; bin: string }[] = [
  { id: "claude", title: "Claude Code", bin: "claude" },
  { id: "codex", title: "Codex CLI", bin: "codex" },
  { id: "zcode", title: "ZCode", bin: "zcode" },
  { id: "cursor", title: "Cursor", bin: "cursor-agent" },
  { id: "kimi", title: "Kimi Code", bin: "kimi" },
  { id: "opencode", title: "OpenCode", bin: "opencode" },
  { id: "antigravity", title: "Antigravity", bin: "antigravity" },
];

export function probeAgentRuntimes(): { id: string; title: string; installed: boolean }[] {
  return AGENT_RUNTIMES.map(({ id, title, bin }) => ({ id, title, installed: probeCli(bin, null).installed }));
}

export interface SetupSystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  /** macOS: Homebrew доступен. */
  hasBrew: boolean;
  /** Linux: apt-get доступен. */
  hasApt: boolean;
  /** Linux: sudo работает без пароля (иначе установка node - вручную). */
  hasPasswordlessSudo: boolean;
}

export function probeSystemInfo(): SetupSystemInfo {
  const platform = process.platform as NodeJS.Platform;
  return {
    platform,
    arch: process.arch,
    hasBrew: probeCli("brew", ["--version"]).installed,
    hasApt: probeCli("apt-get", null).installed,
    hasPasswordlessSudo:
      platform !== "linux" ? false : spawnSync("sudo", ["-n", "true"], { encoding: "utf8", timeout: 3000 }).status === 0,
  };
}

/* ------------------------------ установка системы ---------------------------- */

export type SystemInstallTarget = "bun" | "node" | "workspace";

export const SYSTEM_INSTALL_TARGETS: SystemInstallTarget[] = ["bun", "node", "workspace"];

export function sanitizeSystemTargets(input: unknown): SystemInstallTarget[] {
  if (!Array.isArray(input)) return [];
  const wanted = input.filter((t): t is SystemInstallTarget =>
    typeof t === "string" && (SYSTEM_INSTALL_TARGETS as string[]).includes(t),
  );
  return SYSTEM_INSTALL_TARGETS.filter((t) => wanted.includes(t));
}

/**
 * Цепочка установки системных компонентов - шаги повторяют setup.sh:
 * macOS - brew install (нет brew - отказ с подсказкой terminal-скрипта,
 * интерактивный инсталлер Homebrew из консоли не выполняется); Linux - bun
 * официальным инсталлером файлом в .agents/.tmp/setup (без sudo); node -
 * только через терминал (NodeSource требует sudo). workspace - bun install
 * зависимостей воркспейса. Детект bun/node передаётся вызывающим
 * (probeSetupDeps) - функция чистая и покрывается тестами.
 */
export function buildSystemInstallSteps(opts: {
  targets: SystemInstallTarget[];
  system: SetupSystemInfo;
  repoRoot: string;
  deps: { bunInstalled: boolean; nodeInstalled: boolean; nodeVersion: string | null };
}): { ok: true; steps: ToolJobStep[] } | { ok: false; error: string } {
  const { targets, system, repoRoot, deps } = opts;
  const steps: ToolJobStep[] = [];
  // после установки bun инсталлером (~/.bun/bin) последующие шаги job'а
  // видят его через дополненный PATH (env шага поверх окружения консоли)
  const bunPathEnv = { PATH: `${path.join(homedir(), ".bun", "bin")}:${process.env.PATH ?? ""}` };
  const terminalHint = "выполните bun run setup в терминале - интерактивные инсталлеры из консоли не запускаются";

  for (const target of targets) {
    if (target === "bun") {
      if (deps.bunInstalled) continue;
      if (system.platform === "darwin") {
        if (!system.hasBrew) return { ok: false, error: `Homebrew не найден - ${terminalHint}` };
        steps.push({ label: "Установка bun", command: ["brew", "install", "bun"], env: bunPathEnv });
      } else {
        const dir = path.join(repoRoot, ".agents", ".tmp", "setup");
        const file = path.join(dir, "bun-install.sh");
        steps.push({ label: "Каталог установщиков", command: ["mkdir", "-p", dir] });
        steps.push({ label: "Скачивание инсталлера bun", command: ["curl", "-fsSL", "https://bun.sh/install", "-o", file] });
        steps.push({ label: "Установка bun (инсталлер bun.sh)", command: ["bash", file], env: bunPathEnv });
      }
    }
    if (target === "node") {
      if (deps.nodeInstalled && nodeMajor(deps.nodeVersion) >= NODE_MIN_MAJOR) continue;
      if (system.platform === "darwin") {
        if (!system.hasBrew) return { ok: false, error: `Homebrew не найден - ${terminalHint}` };
        steps.push({ label: `Установка node (≥ ${NODE_MIN_MAJOR})`, command: ["brew", "install", "node"], env: bunPathEnv });
      } else {
        return { ok: false, error: `установка node на Linux требует sudo - ${terminalHint}` };
      }
    }
    if (target === "workspace") {
      if (!deps.bunInstalled && !targets.includes("bun")) {
        return { ok: false, error: "bun не установлен - сначала установите bun" };
      }
      steps.push({
        label: "Зависимости воркспейса (bun install)",
        command: ["bun", "install"],
        cwd: repoRoot,
        env: bunPathEnv,
      });
    }
  }
  if (steps.length === 0) return { ok: false, error: "устанавливать нечего - компоненты уже на месте" };
  return { ok: true, steps };
}

/* ---------------------------- инструменты консоли ---------------------------- */

/** Предвыбранный набор шага "Инструменты" (экономия токенов агентов). */
export const RECOMMENDED_TOOL_IDS = ["serena", "qmd", "codegraph", "graphify", "rtk", "headroom"];
