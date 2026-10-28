import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { processAlive } from "./memory";
import { TOOLS } from "./tools";
import { OPENBOT_DIR } from "./tools/openbot";

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

/** Сколько ждать освобождения порта после SIGTERM (neo4j закрывается до ~11 с). */
export const PORT_RELEASE_TIMEOUT_MS = 15_000;
/** Сколько ждать подъёма порта после спавна (neo4j - ~8 с, lightrag - ~5 с). */
export const PORT_UP_TIMEOUT_MS = 20_000;
/** Лимит штатной stop-команды инструмента (neo4j stop ждёт завершения сам). */
export const STOP_COMMAND_TIMEOUT_MS = 30_000;

/** Пауза. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Штатная stop-команда по id (исполняется после SIGTERM). neo4j: спавн
 * `neo4j console` создаёт supervisor-JVM (её PID попадает в dashboards.json)
 * и серверную JVM (её PID - в pid-файле); SIGTERM завершает supervisor, а
 * серверная живёт ещё ~10 с и держит блокировку запуска, при этом HTTP-порт
 * закрывается раньше. `neo4j stop` читает pid-файл и ждёт фактического
 * завершения серверной JVM.
 */
function stopCommand(toolId: string): { argv: string[]; cwd?: string } | null {
  switch (toolId) {
    case "neo4j":
      return { argv: ["neo4j", "stop"] };
    case "openbot":
      // compose-проект определяется каталогом клонирования; остановка
      // идемпотентна и работает после выхода короткоживущего compose-CLI
      return { argv: ["docker", "compose", "down"], cwd: OPENBOT_DIR };
    default:
      return null;
  }
}

/** Исполнить штатную stop-команду с лимитом времени (ошибки игнорируются). */
async function runStopCommand(toolId: string, timeoutMs: number): Promise<void> {
  const command = stopCommand(toolId);
  if (!command) return;
  await new Promise<void>((resolve) => {
    const child = spawn(command.argv[0], command.argv.slice(1), {
      stdio: "ignore",
      ...(command.cwd ? { cwd: command.cwd } : {}),
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Ждать, пока порт войдёт в нужное состояние (wantOpen: true - принимает
 * соединения, false - свободен); false - таймаут. Единая логика для старта,
 * остановки и перезапуска.
 */
export async function waitForPortState(port: number, wantOpen: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await probePort(port, 300)) === wantOpen) return true;
    if (Date.now() >= deadline) return false;
    await sleep(400);
  }
}

export interface DashboardStartOptions {
  /** Дождаться подъёма порта до ответа (пользовательский старт); 0 - не ждать. */
  waitMs?: number;
}

/**
 * Запустить автономный инстанс дашборда (detached, лог в
 * .agents/console/logs/<id>-dashboard.log). Команды - литеральные case по id;
 * порт - валидированное целое из URL реестра. extraEnv - дополнительные
 * переменные окружения сервиса (lightrag: LLM-биндинг и хранилище из state).
 * options.waitMs - дождаться подъёма порта и вернуть ok:false с путём к логу,
 * если сервис не поднялся (иначе спавн без немедленной ошибки даёт ok:true).
 */
export async function startDashboard(
  repoRoot: string,
  toolId: string,
  extraEnv?: Record<string, string>,
  options?: DashboardStartOptions,
): Promise<DashboardStartResult> {
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
  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const spawnOptions = {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  };
  // Рабочие каталоги сервисов с записью на диск (qdrant: ./storage;
  // lightrag: WORKING_DIR ./rag_storage) - вне репозитория и git.
  const serviceDir = (name: string): string => path.join(repoRoot, ".agents", "console", "services", name);

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
    case "neo4j":
      // `neo4j console` - передний план (Bolt :7687, Browser :7474); данные -
      // в домашнем каталоге brew-формулы, cwd не используется
      child = spawn("neo4j", ["console"], spawnOptions);
      shown = "neo4j console";
      break;
    case "qdrant": {
      // storage ./storage создаётся в cwd; слушающий адрес - 127.0.0.1.
      // Бинарник из GitHub Releases без встроенного Web UI - статику
      // qdrant-web-ui (ставится postInstall-шагом плагина) раздаёт сам
      // qdrant по /dashboard через QDRANT__SERVICE__STATIC_CONTENT_DIR.
      const cwd = serviceDir("qdrant");
      await mkdir(cwd, { recursive: true });
      const { QDRANT_WEB_UI_DIR } = await import("./tools/qdrant");
      child = spawn("qdrant", [], {
        ...spawnOptions,
        cwd,
        env: {
          ...env,
          QDRANT__SERVICE__HOST: "127.0.0.1",
          ...(existsSync(QDRANT_WEB_UI_DIR) ? { QDRANT__SERVICE__STATIC_CONTENT_DIR: QDRANT_WEB_UI_DIR } : {}),
        },
      });
      shown = "qdrant (storage: .agents/console/services/qdrant)";
      break;
    }
    case "lightrag": {
      // WORKING_DIR ./rag_storage создаётся в cwd; HOST/PORT - явные значения
      // (lightrag читает PORT из окружения и без переопределения берёт порт
      // процесса консоли); LLM-биндинг и Neo4j-хранилище - из extraEnv
      const cwd = serviceDir("lightrag");
      await mkdir(cwd, { recursive: true });
      child = spawn("lightrag-server", [], {
        ...spawnOptions,
        cwd,
        env: { ...env, HOST: "127.0.0.1", PORT: String(port) },
      });
      shown = `lightrag-server --host 127.0.0.1 --port ${port} (данные: .agents/console/services/lightrag)`;
      break;
    }
    case "openbot": {
      // Стек OpenBot (Postgres, сервер :3001, приложение :3010, компьютеры
      // ботов) поднимает docker compose из каталога клонирования; ключи из
      // state.openbotConfig дописываются в .env перед стартом. Первый запуск
      // тянет образы минуты - старт карточки идёт без ожидания порта.
      if (!existsSync(OPENBOT_DIR)) {
        await fh.close();
        return { ok: false, error: `каталог OpenBot не найден (${OPENBOT_DIR}) - переустановите инструмент (клон - шаг установки)` };
      }
      const { writeOpenbotEnvFile } = await import("./tools/openbot");
      if (extraEnv && Object.keys(extraEnv).length > 0) {
        await writeOpenbotEnvFile(extraEnv).catch(() => undefined);
      }
      child = spawn("docker", ["compose", "up", "-d", "--wait"], { ...spawnOptions, cwd: OPENBOT_DIR });
      shown = `docker compose up -d --wait (каталог ${OPENBOT_DIR}; интерфейс поднимется на порту ${port})`;
      break;
    }
    default:
      await fh.close();
      return { ok: false, error: `нет команды запуска дашборда для ${toolId}` };
  }
  child.unref();
  await fh.close();

  // Окно на немедленную ошибку спавна (ENOENT - бинаря нет в PATH): запись
  // pid пишем только после того, как процесс не упал сразу.
  const spawnError = await new Promise<Error | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 400);
    child.once("error", (err) => {
      clearTimeout(timer);
      resolve(err instanceof Error ? err : new Error(String(err)));
    });
  });
  if (spawnError) {
    const map = await readDashboards(repoRoot);
    delete map[toolId];
    await writeDashboards(repoRoot, map);
    return { ok: false, error: `${shown}: ${spawnError.message}` };
  }

  const map = await readDashboards(repoRoot);
  map[toolId] = { pid: child.pid ?? -1, startedAt: new Date().toISOString() };
  await writeDashboards(repoRoot, map);

  const waitMs = options?.waitMs ?? 0;
  if (waitMs > 0 && !(await waitForPortState(port, true, waitMs))) {
    return { ok: false, error: `${shown} не поднял порт ${port} за ${Math.round(waitMs / 1000)} с - лог: ${logFile}` };
  }
  return {
    ok: true,
    detail: waitMs > 0
      ? `${shown} запущен (PID ${child.pid ?? "?"}); порт ${port} отвечает; лог: ${logFile}`
      : `${shown} запущен (PID ${child.pid ?? "?"}); дашборд станет доступен через несколько секунд; лог: ${logFile}`,
    port,
  };
}

/**
 * Остановить инстанс, запущенный консолью (SIGTERM + штатная stop-команда,
 * если у инструмента есть; сторонние процессы не затрагиваются). После сигнала
 * ждём освобождения порта (до 15 с): сервисы закрываются не мгновенно, и
 * немедленный повторный старт упал бы на ещё закрываемом инстансе
 * ("Neo4j is already running").
 */
export async function stopDashboard(repoRoot: string, toolId: string): Promise<{ ok: boolean; detail: string }> {
  const map = await readDashboards(repoRoot);
  const record = map[toolId];
  if (!record) return { ok: false, detail: "инстанс не запускался из консоли" };
  const wasAlive = processAlive(record.pid);
  if (wasAlive) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
    }
  }
  // Штатная stop-команда выполняется и без живого pid: у openbot записанный
  // pid - короткоживущий compose-CLI, контейнеры живут после его выхода
  // (compose down идемпотентен; neo4j stop без запущенного сервера - no-op).
  await runStopCommand(toolId, STOP_COMMAND_TIMEOUT_MS);
  delete map[toolId];
  await writeDashboards(repoRoot, map);
  let detail = `инстанс остановлен (PID ${record.pid})`;
  const def = TOOLS.find((t) => t.id === toolId);
  const port = def?.dashboard ? dashboardPort(def.dashboard.url) : null;
  if (wasAlive && port && !(await waitForPortState(port, false, PORT_RELEASE_TIMEOUT_MS))) {
    detail += `; порт ${port} ещё освобождается - старт возможен через несколько секунд`;
  }
  return { ok: true, detail };
}

/**
 * Перезапуск управляемого инстанса: stop (с ожиданием освобождения порта) →
 * start (с ожиданием подъёма). Чужие инстансы (без записи в dashboards.json)
 * не затрагиваются.
 */
export async function restartDashboard(
  repoRoot: string,
  toolId: string,
  extraEnv?: Record<string, string>,
): Promise<{ ok: boolean; detail: string }> {
  await stopDashboard(repoRoot, toolId);
  const result = await startDashboard(repoRoot, toolId, extraEnv, { waitMs: PORT_UP_TIMEOUT_MS });
  if (!result.ok) return { ok: false, detail: result.error };
  return { ok: true, detail: `${result.detail}` };
}

/** PID работающего инстанса, запущенного консолью (для кнопки "Остановить"). */
export async function dashboardManagedPid(repoRoot: string, toolId: string): Promise<number | null> {
  const record = (await readDashboards(repoRoot))[toolId];
  if (!record) return null;
  return processAlive(record.pid) ? record.pid : null;
}

/** Все живые управляемые PID: pid → toolId (инвентаризация процессов консоли). */
export async function managedDashboardPids(repoRoot: string): Promise<Map<number, string>> {
  const map = await readDashboards(repoRoot);
  const result = new Map<number, string>();
  for (const [toolId, record] of Object.entries(map)) {
    if (record.pid > 1 && processAlive(record.pid)) result.set(record.pid, toolId);
  }
  return result;
}
