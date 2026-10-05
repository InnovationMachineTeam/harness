import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { processAlive } from "./memory";
import { TOOLS } from "./tools";

/**
 * Локальные дашборды инструментов (Serena :24282, Headroom :8787) работают,
 * только пока запущен сам инструмент: Serena запускает дашборд вместе со
 * своим MCP-сервером (стартует вместе с сессией агента), Headroom - вместе
 * с прокси. Консоль умеет: (1) проверять доступность TCP-пробой порта (только
 * установка соединения, без HTTP-запросов); (2) запускать/останавливать
 * автономный инстанс (detached-процесс, как сборка OpenWiki), pid - в
 * .agents/console/dashboards.json. Спавн - литеральные команды по id
 * инструмента (allowlist), порт валидируется как целое число.
 */

export interface DashboardRecord {
  pid: number;
  startedAt: string;
}

export function dashboardsFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "dashboards.json");
}

async function readDashboards(repoRoot: string): Promise<Record<string, DashboardRecord>> {
  try {
    const raw = JSON.parse(await readFile(dashboardsFilePath(repoRoot), "utf8")) as Record<string, DashboardRecord>;
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

async function writeDashboards(repoRoot: string, map: Record<string, DashboardRecord>): Promise<void> {
  const file = dashboardsFilePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** Порт дашборда из URL реестра (адреса - литералы из core/tools.ts). */
export function dashboardPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const port = Number.parseInt(parsed.port, 10);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/** Работает ли дашборд: TCP-проба порта (соединение без отправки HTTP-запроса). */
export function probePort(port: number, timeoutMs = 700): Promise<boolean> {
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

void createServer; // net-примитив держим единым импортом (проба выше)

export type DashboardStartResult =
  | { ok: true; detail: string; port: number }
  | { ok: false; error: string };

/**
 * Запустить автономный инстанс дашборда (detached, лог в
 * .agents/console/logs/<id>-dashboard.log). Команды - литеральные case по id;
 * порт - валидированное целое из URL реестра.
 */
export async function startDashboard(repoRoot: string, toolId: string): Promise<DashboardStartResult> {
  const def = TOOLS.find((t) => t.id === toolId);
  const url = def?.dashboard?.url;
  if (!def || !url) return { ok: false, error: `у инструмента нет дашборда: ${toolId}` };
  const port = dashboardPort(url);
  if (!port) return { ok: false, error: `не удалось определить порт дашборда: ${url}` };
  if (await probePort(port)) {
    return { ok: true, detail: `порт ${port} уже принимает соединения - дашборд уже запущен`, port };
  }

  const logDir = path.join(repoRoot, ".agents", "console", "logs");
  await mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, `${toolId}-dashboard.log`);
  const fh = await open(logFile, "a");
  const spawnOptions = {
    cwd: repoRoot,
    env: process.env,
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  };

  // Литеральный allowlist команд (как спавн-allowlist core/prompts.ts).
  let child;
  let shown: string;
  switch (toolId) {
    case "serena":
      // MCP-сервер в HTTP-режиме запускает и web-dashboard на 127.0.0.1:24282;
      // самому MCP берём свободный соседний порт (9121 - из док Serena).
      // --project-from-cwd активирует проект консоли (cwd = корень репо) -
      // без него вкладки Tools/Modes/Contexts и проект пусты.
      // Дашборд включаем флагом (в конфиге пользователя он может быть
      // выключен), браузер при этом не открываем.
      child = spawn(
        "serena",
        [
          "start-mcp-server",
          "--transport",
          "streamable-http",
          "--port",
          "9121",
          "--project-from-cwd",
          "--enable-web-dashboard",
          "true",
          "--open-web-dashboard",
          "false",
        ],
        spawnOptions,
      );
      shown =
        "serena start-mcp-server --transport streamable-http --port 9121 --project-from-cwd --enable-web-dashboard true --open-web-dashboard false";
      break;
    case "headroom":
      // прокси раздаёт /dashboard на своём порту
      child = spawn("headroom", ["proxy", "--port", String(port)], spawnOptions);
      shown = `headroom proxy --port ${port}`;
      break;
    case "agentplane":
      // read-only дашборд графа знания из .agentplane workspace (cwd = корень репозитория)
      child = spawn("agentplane", ["context", "dashboard", "--host", "127.0.0.1", "--port", String(port)], spawnOptions);
      shown = `agentplane context dashboard --host 127.0.0.1 --port ${port}`;
      break;
    default:
      await fh.close();
      return { ok: false, error: `нет команды запуска дашборда для ${toolId}` };
  }
  child.on("error", () => {
    /* ENOENT - состояние покажет проба порта */
  });
  child.unref();
  await fh.close();

  const map = await readDashboards(repoRoot);
  map[toolId] = { pid: child.pid ?? -1, startedAt: new Date().toISOString() };
  await writeDashboards(repoRoot, map);
  return {
    ok: true,
    detail: `${shown} запущен (PID ${child.pid ?? "?"}); дашборд станет доступен через несколько секунд; лог: ${logFile}`,
    port,
  };
}

/** Остановить инстанс, запущенный консолью (SIGTERM; сторонние процессы не затрагиваются). */
export async function stopDashboard(repoRoot: string, toolId: string): Promise<{ ok: boolean; detail: string }> {
  const map = await readDashboards(repoRoot);
  const record = map[toolId];
  if (!record) return { ok: false, detail: "инстанс не запускался из консоли" };
  if (processAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
    }
  }
  delete map[toolId];
  await writeDashboards(repoRoot, map);
  return { ok: true, detail: `инстанс остановлен (PID ${record.pid})` };
}

/** Пауза. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Перезапуск управляемого инстанса: stop → дождаться освобождения порта
 * (SIGTERM закрывает процесс не мгновенно) → start. Чужие инстансы (без
 * записи в dashboards.json) не затрагиваются.
 */
export async function restartDashboard(
  repoRoot: string,
  toolId: string,
): Promise<{ ok: boolean; detail: string }> {
  const def = TOOLS.find((t) => t.id === toolId);
  const port = def?.dashboard ? dashboardPortOf(def.dashboard.url) : null;
  await stopDashboard(repoRoot, toolId);
  if (port) {
    // ждём, пока порт реально освободится (до ~10 с)
    for (let i = 0; i < 20; i += 1) {
      if (!(await probePort(port, 300))) break;
      await sleep(500);
    }
  }
  const result = await startDashboard(repoRoot, toolId);
  if (!result.ok) return { ok: false, detail: result.error };
  // ждём, пока порт начнёт принимать соединения (до ~20 с), чтобы рестарт завершился фактически
  if (port) {
    for (let i = 0; i < 40; i += 1) {
      if (await probePort(port, 300)) {
        return { ok: true, detail: `${result.detail}; дашборд поднялся` };
      }
      await sleep(500);
    }
  }
  return { ok: true, detail: `${result.detail}; порт ещё запускается - обновите модалку через несколько секунд` };
}

function dashboardPortOf(url: string): number | null {
  try {
    const parsed = new URL(url);
    const n = Number.parseInt(parsed.port, 10);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  } catch {
    return null;
  }
}

/** PID работающего инстанса, запущенного консолью (для кнопки "Остановить"). */
export async function dashboardManagedPid(repoRoot: string, toolId: string): Promise<number | null> {
  const record = (await readDashboards(repoRoot))[toolId];
  if (!record) return null;
  return processAlive(record.pid) ? record.pid : null;
}
