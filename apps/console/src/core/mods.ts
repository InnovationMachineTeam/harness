import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ConsoleState } from "./state";

/**
 * Моды Claude Code: плагины с hooks-модулями (или обычные community-плагины),
 * устанавливаемые официальным marketplace-механизмом CLI `claude plugin`.
 * Каталог фиксирован (MOD_CATALOG); консоль выполняет команды CLI, состояние
 * хранит зеркало статусов - источник истины сверяется командой `claude plugin list --json`.
 */

export interface ModMarketplaceGithub {
  kind: "github";
  /** Аргумент `claude plugin marketplace add`: owner/repo, URL или путь. */
  source: string;
  /** Имя marketplace (вторя часть plugin@marketplace). */
  name: string;
}

/** Marketplace в подкаталоге репозитория: требуется предварительный shallow-clone. */
export interface ModMarketplaceClone {
  kind: "clone";
  repo: string;
  subPath: string;
  name: string;
}

export interface ModDef {
  id: string;
  displayName: string;
  description: string;
  url: string;
  marketplace: ModMarketplaceGithub | ModMarketplaceClone;
  /** имя@marketplace для команд install/enable/disable/uninstall. */
  plugin: string;
  /** Требование к версии Claude Code (hooks-моды грузятся с 2.1.287+). */
  requires?: string;
  /** Внешний шаг, который консоль не выполняет (например, установка приложения). */
  prerequisite?: { label: string; command: string };
  /** Пояснение использования (модалка жизненного цикла). */
  notes?: string;
}

/** Зеркало статуса мода в state.mods (источник истины - CLI claude plugin). */
export interface InstalledMod {
  id: string;
  enabled: boolean;
  installedAt: string;
}

/** Каталог модов вкладки "Настройки → Моды" (подвкладка Claude). */
export const MOD_CATALOG: ModDef[] = [
  {
    id: "savvy-progress",
    displayName: "Savvy Progress",
    description:
      "Прогресс-бар фаз и задач над промптом и живая панель субагентов (модель, контекст, оценка стоимости); отчётность оркестратора и воркеров через MCP-инструменты progress и step.",
    url: "https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress",
    marketplace: { kind: "github", source: "johnnyvizz/claude-kit", name: "claude-kit" },
    plugin: "savvy-progress@claude-kit",
    notes: "Язык панели настраивается в /config (pluginConfigs → savvy-progress) или в ~/.claude/settings.json.",
  },
  {
    id: "claude-skins",
    displayName: "Claude Skins",
    description:
      "Переписывает отрисовку вывода: вызовы инструментов с иконками и таймингами, diff-карточки правок, полоса usage и 15 скинов цветов. Меняет только отображение, не содержимое разговора.",
    url: "https://github.com/hellosverre/claude-skins",
    marketplace: { kind: "github", source: "hellosverre/claude-skins", name: "hellosverre-mods" },
    plugin: "skins@hellosverre-mods",
    requires: "2.1.287+",
    notes: "Команда /skin управляет скинами; /skin off возвращает штатный рендеринг без удаления мода.",
  },
  {
    id: "filetree",
    displayName: "Filetree",
    description:
      "IDE-подобное дерево файлов сбоку с индикацией активности Claude (чтения, записи, коммиты), git-статусом и выбором файлов как контекста промпта.",
    url: "https://github.com/data-goblin/claude-code-filetree",
    marketplace: { kind: "github", source: "data-goblin/claude-code-filetree", name: "claude-code-filetree" },
    plugin: "filetree@claude-code-filetree",
    notes: "Команда /filetree открывает панель; нужен полноэкранный режим (/tui fullscreen) и не меньше 110 колонок.",
  },
  {
    id: "cache-tax",
    displayName: "Cache Tax",
    description:
      "Греет промпт-кэш во время простоя (/keepwarm) и перед холодной отправкой показывает расчётную стоимость перезаписи кэша.",
    url: "https://github.com/karanb192/cache-tax",
    marketplace: { kind: "github", source: "karanb192/claude-code-mods", name: "claude-code-mods" },
    plugin: "cache-tax@claude-code-mods",
    requires: "2.1.287+",
    notes: "У автора есть отдельная hook-версия (karanb192/claude-code-hooks) - ставить только одну из двух.",
  },
  {
    id: "blast-radius",
    displayName: "Blast Radius",
    description:
      "Официальный мод Anthropic: перехватывает рискованные shell-команды (rm -rf, git reset --hard, force push, миграции) до запуска и показывает, что изменится, с кнопками Proceed/Cancel.",
    url: "https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius",
    marketplace: { kind: "clone", repo: "anthropics/claude-code-playground", subPath: "claude-code/mods", name: "claude-code-playground-mods" },
    plugin: "blast-radius@claude-code-playground-mods",
    requires: "2.1.287+",
    notes: "Страховка, а не система прав: для жёстких блоков нужны permission rules.",
  },
  {
    id: "reflect",
    displayName: "Reflect",
    description:
      "Самообучение: хуки ловят корректировки и паттерны работы, /reflect превращает одобренные выводы в постоянную память (CLAUDE.md/AGENTS.md) и навыки.",
    url: "https://github.com/BayramAnnakov/claude-reflect",
    marketplace: { kind: "github", source: "bayramannakov/claude-reflect", name: "claude-reflect-marketplace" },
    plugin: "claude-reflect@claude-reflect-marketplace",
    notes: "Существует вариант reflect-mod (hooks-модуль, CC 2.1.286+) - ставить только один из двух, иначе двойной захват.",
  },
  {
    id: "terminal-browser",
    displayName: "Terminal Browser",
    description:
      "Chromium-браузер, отрисованный в терминале (kitty graphics protocol, поддержка мыши, SSH-проксирование); плагин даёт команду /browser и опциональный агент-инструмент.",
    url: "https://github.com/zenbu-labs/terminal-browser",
    marketplace: { kind: "github", source: "zenbu-labs/terminal-browser", name: "terminal-browser" },
    plugin: "terminal-browser@terminal-browser",
    prerequisite: { label: "приложение terminal-browser", command: "brew install terminal-browser" },
    notes: "Агент-инструмент включается в /config (pluginConfigs → terminal-browser → options → agentTool).",
  },
  {
    id: "replay-theater",
    displayName: "Replay Theater",
    description:
      "Официальный мод Anthropic: записывает правки файлов за ход Claude и позволяет после хода пошагово листать диффы в отдельной панели; только наблюдает, ничего не блокирует.",
    url: "https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater",
    marketplace: { kind: "clone", repo: "anthropics/claude-code-playground", subPath: "claude-code/mods", name: "claude-code-playground-mods" },
    plugin: "replay-theater@claude-code-playground-mods",
    requires: "2.1.287+",
    notes: "Открытие реплея: /replay или ctrl+x, Tab, затем r; навигация n/p/c.",
  },
];

export function findMod(id: string): ModDef | undefined {
  return MOD_CATALOG.find((mod) => mod.id === id);
}

/** Источник marketplace для показа пользователю. */
export function modMarketplaceSource(mod: ModDef): string {
  return mod.marketplace.kind === "github" ? mod.marketplace.source : `${mod.marketplace.repo} → ${mod.marketplace.subPath}`;
}

export interface ModOpResult {
  ok: boolean;
  /** Хвост комбинированного вывода выполненных команд (без ANSI-кодов). */
  output?: string;
  error?: string;
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Вызов внешней команды: аргументы списком, без shell; stdout целиком (до 1 МБ, для парсинга JSON), output - хвост до 4 КБ. */
function runCmd(command: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      const next = (target === "stdout" ? stdout : stderr) + chunk.toString();
      if (target === "stdout") stdout = next.slice(-1_000_000);
      else stderr = next.slice(-16_000);
    };
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout?.on("data", collect("stdout"));
    child.stderr?.on("data", collect("stderr"));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}${err}`, output: `${stdout}${stderr}${err}`.replace(ANSI_RE, "").trim().slice(-4_000) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = `${stdout}${stderr}`.replace(ANSI_RE, "").trim().slice(-4_000);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.replace(ANSI_RE, "").trim(), output });
    });
  });
}

/** Доступность CLI claude (та же проверка, что в синке MCP). */
export function claudeCliAvailable(): boolean {
  return !spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10_000 }).error;
}

const cloneDir = (repoRoot: string, repo: string): string =>
  path.join(repoRoot, ".agents", ".tmp", "mods", repo.split("/").pop() ?? repo);

/** Shallow-clone репозитория marketplace в .agents/.tmp/mods (разрешённая зона); существующий клон переиспользуется. */
async function ensureClone(repoRoot: string, repo: string): Promise<ModOpResult & { dir: string }> {
  const dir = cloneDir(repoRoot, repo);
  if (existsSync(dir)) return { ok: true, dir };
  await mkdir(path.dirname(dir), { recursive: true });
  const clone = await runCmd("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, dir], 180_000);
  if (!clone.ok) {
    await rm(dir, { recursive: true, force: true });
    return { ok: false, dir, error: `git clone ${repo}: ${clone.output || "неизвестная ошибка"}` };
  }
  return { ok: true, dir };
}

/** Добавить marketplace, если его ещё нет в зеркале; ошибки "already added" считаются успехом. */
async function ensureMarketplace(repoRoot: string, state: ConsoleState, mod: ModDef): Promise<ModOpResult> {
  if (state.mods.marketplaces.includes(mod.marketplace.name)) return { ok: true };
  let source: string;
  if (mod.marketplace.kind === "github") {
    source = mod.marketplace.source;
  } else {
    const clone = await ensureClone(repoRoot, mod.marketplace.repo);
    if (!clone.ok) return { ok: false, error: clone.error };
    source = path.join(clone.dir, mod.marketplace.subPath);
  }
  const added = await runCmd("claude", ["plugin", "marketplace", "add", source], 120_000);
  if (!added.ok && !/already|exists/i.test(added.output)) {
    return { ok: false, error: `claude plugin marketplace add: ${added.output || "неизвестная ошибка"}` };
  }
  if (!state.mods.marketplaces.includes(mod.marketplace.name)) state.mods.marketplaces.push(mod.marketplace.name);
  return { ok: true, output: added.output };
}

/** Установить мод: marketplace add (при необходимости) + claude plugin install --scope user -y. */
export async function installMod(repoRoot: string, state: ConsoleState, id: string): Promise<ModOpResult> {
  const mod = findMod(id);
  if (!mod) return { ok: false, error: `мод не найден в каталоге: ${id}` };
  if (state.mods.installed[id]) return { ok: false, error: `мод уже установлен: ${mod.displayName}` };
  const marketplace = await ensureMarketplace(repoRoot, state, mod);
  if (!marketplace.ok) return marketplace;
  const installed = await runCmd("claude", ["plugin", "install", mod.plugin, "--scope", "user", "-y"], 180_000);
  if (!installed.ok) {
    return { ok: false, error: `claude plugin install ${mod.plugin}: ${installed.output || "неизвестная ошибка"}` };
  }
  state.mods.installed[id] = { id, enabled: true, installedAt: new Date().toISOString() };
  return { ok: true, output: [marketplace.output, installed.output].filter(Boolean).join("\n") };
}

/** Включить или выключить установленный мод (claude plugin enable/disable). */
export async function setModEnabled(state: ConsoleState, id: string, enabled: boolean): Promise<ModOpResult> {
  const mod = findMod(id);
  if (!mod) return { ok: false, error: `мод не найден в каталоге: ${id}` };
  if (!state.mods.installed[id]) return { ok: false, error: `мод не установлен: ${mod.displayName}` };
  const result = await runCmd("claude", ["plugin", enabled ? "enable" : "disable", mod.plugin], 60_000);
  if (!result.ok) {
    return { ok: false, error: `claude plugin ${enabled ? "enable" : "disable"} ${mod.plugin}: ${result.output || "неизвестная ошибка"}` };
  }
  state.mods.installed[id].enabled = enabled;
  return { ok: true, output: result.output };
}

/** Удалить мод (claude plugin uninstall); marketplace остаётся добавленным. */
export async function uninstallMod(state: ConsoleState, id: string): Promise<ModOpResult> {
  const mod = findMod(id);
  if (!mod) return { ok: false, error: `мод не найден в каталоге: ${id}` };
  if (!state.mods.installed[id]) return { ok: false, error: `мод не установлен: ${mod.displayName}` };
  const removed = await runCmd("claude", ["plugin", "uninstall", mod.plugin], 120_000);
  if (!removed.ok) {
    return { ok: false, error: `claude plugin uninstall ${mod.plugin}: ${removed.output || "неизвестная ошибка"}` };
  }
  delete state.mods.installed[id];
  return { ok: true, output: removed.output };
}

interface ClaudePluginListEntry {
  id?: string;
  enabled?: boolean;
  scope?: string;
}

/**
 * Сверка зеркала с CLI: claude plugin list --json (источник истины) и
 * claude plugin marketplace list --json. Бросает исключение при непарсируемом
 * выводе - вызывающий оставляет состояние как есть.
 */
export async function reconcileMods(state: ConsoleState): Promise<void> {
  const list = await runCmd("claude", ["plugin", "list", "--json"], 60_000);
  if (!list.ok) throw new Error(`claude plugin list: ${list.output || "неизвестная ошибка"}`);
  const entries = JSON.parse(list.stdout) as ClaudePluginListEntry[];
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id as string, e]));
  for (const mod of MOD_CATALOG) {
    const entry = byId.get(mod.plugin);
    if (entry) {
      const existing = state.mods.installed[mod.id];
      state.mods.installed[mod.id] = {
        id: mod.id,
        enabled: entry.enabled ?? existing?.enabled ?? true,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
      };
    } else {
      delete state.mods.installed[mod.id];
    }
  }
  const marketplaces = await runCmd("claude", ["plugin", "marketplace", "list", "--json"], 60_000);
  if (marketplaces.ok) {
    const parsed = JSON.parse(marketplaces.stdout) as { name?: string }[];
    state.mods.marketplaces = parsed.map((m) => m.name ?? "").filter(Boolean);
  }
}
