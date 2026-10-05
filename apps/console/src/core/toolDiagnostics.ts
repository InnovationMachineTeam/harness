import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { probePort } from "./dashboards";
import { effectiveToolState, toolById, toolRuntimeInstalled, type ToolDef, type ToolRuntimeId } from "./tools";
import type { ConsoleState } from "./state";

/**
 * Диагностика инструмента (кнопка "Диагностика"): набор проверок "работает
 * ли инструмент" - CLI, зависимости, per-runtime интеграции, MCP-реестр,
 * доступность дашборда. По провалам собирается промпт для headless-исправления
 * (POST /api/prompts/run).
 */

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  /** Детали: версии, пути, что именно не так. */
  detail: string;
  /** Провал критичен (попадает в промпт исправления). */
  critical: boolean;
}

export interface ToolDiagnostic {
  toolId: string;
  ok: boolean;
  checks: DiagnosticCheck[];
  prompt: string | null;
}

function checkCli(def: ToolDef): DiagnosticCheck {
  const which = spawnSync("which", [def.bin], { encoding: "utf8", timeout: 3000 });
  const installed = which.status === 0 && which.stdout.trim().length > 0;
  if (!installed) {
    return {
      name: `CLI ${def.bin}`,
      ok: false,
      detail: "не найден в PATH - установите системный пакет (Настройки → Инструменты → Установить)",
      critical: true,
    };
  }
  return { name: `CLI ${def.bin}`, ok: true, detail: which.stdout.trim(), critical: true };
}

function checkDependency(def: ToolDef): DiagnosticCheck | null {
  if (!def.requires) return null;
  const which = spawnSync("which", [def.requires.bin], { encoding: "utf8", timeout: 3000 });
  const ok = which.status === 0;
  return {
    name: `Зависимость: ${def.requires.bin}`,
    ok,
    detail: ok ? "установлена" : "не найдена - нужна для установки и обновления инструмента",
    critical: false,
  };
}

function checkPerRuntime(def: ToolDef, home: string, repoRoot: string, state: ConsoleState): DiagnosticCheck[] {
  const per = def.perRuntime;
  if (!per) return [];
  const checks: DiagnosticCheck[] = [];
  const unsupported = (["claude", "codex", "zcode", "cursor", "kimi", "opencode"] as ToolRuntimeId[]).filter(
    (r) => !per.supported.includes(r),
  );
  for (const runtime of per.supported) {
    const installed = toolRuntimeInstalled(def, runtime, home, repoRoot, state);
    checks.push({
      name: `Интеграция: ${runtime}`,
      // отсутствие per-runtime интеграции - не поломка (опционально)
      ok: true,
      detail: installed ? "установлена" : "не установлена (опционально - установите через панель, если нужна)",
      critical: false,
    });
  }
  if (unsupported.length > 0) {
    checks.push({
      name: "Неподдерживаемые рантаймы",
      ok: true,
      detail: unsupported
        .map((r) => `${r}${per.notes?.[r] ? ` - ${per.notes[r]}` : ""}`)
        .join("; "),
      critical: false,
    });
  }
  return checks;
}

function checkMcp(def: ToolDef, state: ConsoleState): DiagnosticCheck | null {
  if (!def.mcpPreset) return null;
  const server = state.mcp.servers[def.id];
  return {
    name: "MCP-сервер",
    // не зарегистрированный MCP - не поломка CLI-инструмента (инфо)
    ok: true,
    detail: server
      ? server.enabled
        ? "зарегистрирован и включён (синк в конфиги рантаймов выполнен)"
        : "зарегистрирован, но выключен - включите на странице MCP"
      : "не зарегистрирован (опционально - установите через панель)",
    critical: false,
  };
}

async function checkDashboard(
  def: ToolDef,
  repoRoot: string,
  state: ConsoleState,
): Promise<DiagnosticCheck[]> {
  if (!def.dashboard) return [];
  const { probePort, dashboardManagedPid } = await import("./dashboards");
  const port = dashboardPortOf(def.dashboard.url);
  const live = port ? await probePort(port) : false;
  const managedPid = await dashboardManagedPid(repoRoot, def.id);
  const autostart = state.tools.autostart[def.id] === true;
  const checks: DiagnosticCheck[] = [
    {
      name: `Дашборд (порт ${port ?? "?"})`,
      ok: live,
      detail: live
        ? "порт принимает соединения - дашборд доступен"
        : managedPid
          ? "инстанс запущен, но порт не принимает соединения - сервис ещё запускается или остановился из-за ошибки (лог: .agents/console/logs/)"
          : autostart
            ? "не запущен, хотя включён автозапуск - попробуйте перезагрузить страницу или запустить вручную"
            : "не запущен - \"Дашборд\" → \"Запустить автономный инстанс\"",
      critical: false,
    },
  ];
  if (managedPid && !live) {
    checks.push({
      name: "Инстанс без дашборда",
      ok: false,
      detail: `процесс ${managedPid} запущен, но порт не принимает соединения - перезапустите инстанс (стоп + старт в модалке дашборда)`,
      critical: true,
    });
  }
  if (def.id === "serena" && live && port) {
    // Serena работает "в рамках harness", когда её инстанс поддерживает активным
    // проект консоли: проверяем через API дашборда (литеральный loopback GET)
    checks.push(...(await checkSerenaRuntime(port, repoRoot, state)));
  }
  if (def.id === "headroom" && live && port) {
    checks.push(await checkHeadroomRuntime(port));
  }
  return checks;
}

interface HeadroomStats {
  summary?: { api_requests?: number; compression?: { requests_compressed?: number } };
}

/** Headroom-специфика: прокси отвечает, и проходил ли через него трафик. Счётчики - из /stats (в /health 0.39.x summary нет). */
async function checkHeadroomRuntime(port: number): Promise<DiagnosticCheck> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/stats`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { name: "Headroom: прокси и трафик", ok: false, detail: `HTTP ${res.status} от /stats`, critical: false };
    }
    const stats = (await res.json()) as HeadroomStats;
    const requests = stats.summary?.api_requests ?? 0;
    const compressed = stats.summary?.compression?.requests_compressed ?? 0;
    return {
      name: "Headroom: прокси и трафик",
      ok: true,
      detail:
        requests === 0
          ? "прокси запущен, но трафик не маршрутизировался - запустите сессию через headroom wrap <runtime> (или ANTHROPIC_BASE_URL=http://127.0.0.1:8787), после чего здесь появятся метрики сжатия"
          : `запросов через прокси: ${requests}, сжато: ${compressed}`,
      critical: false,
    };
  } catch (err) {
    return {
      name: "Headroom: прокси и трафик",
      ok: false,
      detail: `нет ответа /stats: ${err instanceof Error ? err.message : String(err)}`,
      critical: false,
    };
  }
}

interface SerenaConfigOverview {
  active_project?: { path?: string | null };
  active_tools?: string[];
  available_contexts?: { name?: string }[];
}

/** Сериa-специфика: активный проект, tools, контексты (chatgpt/claude-code/codex/vscode). */
async function checkSerenaRuntime(
  port: number,
  repoRoot: string,
  state: ConsoleState,
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  let config: SerenaConfigOverview | null = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/get_config_overview`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.ok) config = (await res.json()) as SerenaConfigOverview;
  } catch {
    /* API недоступен - проверки ниже сообщат "нет данных" */
  }
  if (!config) {
    return [
      {
        name: "Serena runtime (активный проект)",
        ok: false,
        detail: "API дашборда не ответил - Serena запущена без web-dashboard или ещё стартует",
        critical: false,
      },
    ];
  }
  const activePath = config.active_project?.path ?? null;
  const { workspaceDirs } = await import("./state");
  const workspaces = workspaceDirs(state);
  const inWorkspaces = activePath
    ? workspaces.some((dir) => activePath === dir || activePath.startsWith(`${dir}/`))
    : false;
  checks.push({
    name: "Serena: активный проект",
    ok: Boolean(activePath && inWorkspaces),
    detail: activePath
      ? inWorkspaces
        ? `${activePath} - входит в рабочие папки`
        : `${activePath} - вне рабочих папок консоли`
      : "не активирован - инстанс запущен без проекта (перезапустите инстанс из консоли)",
    critical: true,
  });
  const toolsCount = config.active_tools?.length ?? 0;
  checks.push({
    name: "Serena: доступные tools",
    ok: toolsCount >= 10,
    detail: `${toolsCount} инструментов${toolsCount >= 10 ? " доступны" : " - подозрительно мало, проверьте контекст/проект"}`,
    critical: false,
  });
  const names = (config.available_contexts ?? []).map((c) => c.name ?? "");
  const required = ["chatgpt", "claude-code", "codex", "vscode"];
  const missing = required.filter((n) => !names.includes(n));
  checks.push({
    name: "Serena: контексты",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${names.length} контекстов, покрыты ${required.join(", ")}`
        : `нет контекстов: ${missing.join(", ")}`,
    critical: false,
  });
  return checks;
}

function dashboardPortOf(url: string): number | null {
  try {
    const n = Number.parseInt(new URL(url).port, 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function checkMarkerFiles(def: ToolDef, home: string, repoRoot: string): DiagnosticCheck[] {
  // rtk 0.50: хук - команда "rtk hook claude" в settings.json (файла
  // hooks/rtk-rewrite.sh нет); RTK.md - slim-инструкции
  if (def.id !== "rtk") return [];
  const checks: DiagnosticCheck[] = [];
  const rtkMd = path.join(home, ".claude", "RTK.md");
  checks.push({
    name: "RTK.md (Claude)",
    ok: existsSync(rtkMd),
    detail: existsSync(rtkMd) ? `${rtkMd} - инструкции префикса rtk` : "нет - переустановите интеграцию claude (rtk init -g)",
    critical: false,
  });
  const settings = path.join(home, ".claude", "settings.json");
  const hookWired = existsSync(settings)
    ? spawnSync("grep", ["-c", "rtk hook claude", settings], { encoding: "utf8", timeout: 3000 }).status === 0
    : false;
  checks.push({
    name: "Хук в settings.json (rtk hook claude)",
    ok: hookWired,
    detail: hookWired
      ? "PreToolUse настроен - вывод Bash-команд сжимается автоматически"
      : "хук не прописан - вывод не сжимается автоматически; переустановите интеграцию claude (rtk init -g --auto-patch)",
    critical: false,
  });
  return checks;
}

/** Прогнать диагностику инструмента. */
export async function runToolDiagnostics(
  repoRoot: string,
  state: ConsoleState,
  toolId: string,
): Promise<ToolDiagnostic | null> {
  const def = toolById(toolId);
  if (!def) return null;
  const home = homedir();
  const checks: DiagnosticCheck[] = [];

  checks.push(checkCli(def));
  const dep = checkDependency(def);
  if (dep) checks.push(dep);
  checks.push(...checkPerRuntime(def, home, repoRoot, state));
  const mcp = checkMcp(def, state);
  if (mcp) checks.push(mcp);
  checks.push(...(await checkDashboard(def, repoRoot, state)));
  checks.push(...checkMarkerFiles(def, home, repoRoot));

  const st = effectiveToolState(def, state, home, repoRoot);
  checks.push({
    name: "Состояние в консоли",
    ok: true,
    detail:
      st === "on"
        ? "включён"
        : st === "off"
          ? "выключен (интеграции сняты, системный пакет остаётся)"
          : "не установлен через консоль (системный пакет может стоять - см. CLI выше)",
    critical: false,
  });

  // инструмент "не работает" только при критичных провалах (CLI и т.п.);
  // опциональные пункты - информационные
  const failed = checks.filter((c) => !c.ok && c.critical);
  return {
    toolId: def.id,
    ok: failed.length === 0,
    checks,
    prompt: failed.length > 0 ? buildToolFixPrompt(def, failed) : null,
  };
}

/** Промпт headless-исправления по проваленным проверкам. */
export function buildToolFixPrompt(def: ToolDef, failed: DiagnosticCheck[]): string {
  const platform = process.platform === "darwin" ? "macOS" : "Linux";
  const problems = failed.map((c, i) => `${i + 1}. ${c.name}: ${c.detail}`).join("\n");
  return [
    `Исправь работу инструмента ${def.title} (${def.id}) в этом репозитории.`,
    "",
    "Диагностика нашла проблемы:",
    problems,
    "",
    "Что сделать:",
    `- установи/переустанови недостающее (системный пакет: ${def.systemInstall("bun", process.platform as NodeJS.Platform)?.join(" ") ?? "см. docs/tools.md"}),`,
    "- восстанови per-runtime интеграции (см. docs/tools.md и AGENTS.md §10),",
    "- перезапусти сервисы, если нужны (autostart/дашборд - Настройки → Инструменты),",
    "- после исправлений прогони повторную диагностику и покажи результат.",
    "",
    `Платформа: ${platform}. Соблюдай AGENTS.md и guard (установки - с подтверждением политики).`,
  ].join("\n");
}
