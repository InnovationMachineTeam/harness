import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { processAlive } from "./memory";

/**
 * Реестр задач консоли: каждая запущенная задача (промт в headless-сессии,
 * запрос провайдеру, сборка OpenWiki/Graphify) пишет мету-файл в
 * .agents/console/tasks/. Статусы "running" финализируются лениво при чтении
 * списка: процесс с pid закончился или лог с момента старта содержит ошибку.
 * Задачи независимы и запускаются параллельно - глобальных блокировок нет.
 */

export type TaskKind = "prompt" | "openwiki-build" | "graphify-build" | "graphify-wiki";

export type TaskExecutor =
  | { type: "runtime"; id: string }
  | { type: "provider"; id: string }
  | { type: "tool"; id: string };

export type TaskStatus = "running" | "completed" | "failed" | "interrupted";

export interface TaskMeta {
  id: string;
  kind: TaskKind;
  /** Краткое описание для списка: тема промта или режим и папка сборки. */
  title: string;
  executor: TaskExecutor;
  /** Отображаемая модель: tier standard рантайма, модель провайдера или LLM инструмента. */
  model: string | null;
  /** Процесс задачи; null - задача идёт в процессе консоли (запрос провайдеру). */
  pid: number | null;
  status: TaskStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Рантайм, в списке сессий которого видна задача (/runtime/<id>). */
  sessionRuntime: string | null;
  /** Абсолютный путь лог-файла; чтение ошибок - от logStartOffset. */
  logFile: string | null;
  /** Размер лога на момент старта: старые попытки в append-логе не читаются. */
  logStartOffset: number;
  /** Дополнительный контекст: рабочая папка сборки и т.п. */
  detail: string | null;
  /** Correlation с workflow; отсутствует у обычных задач Console. */
  workflowRunId?: string | null;
  workflowStepId?: string | null;
  agentId?: string | null;
  parentAgentId?: string | null;
}

/** Метапараметры запуска, общие для всех спавнов задач. */
export interface TaskLaunchInfo {
  kind: TaskKind;
  title: string;
  executor: TaskExecutor;
  model: string | null;
  pid: number | null;
  sessionRuntime: string | null;
  logFile: string | null;
  detail: string | null;
  workflowRunId?: string | null;
  workflowStepId?: string | null;
  agentId?: string | null;
  parentAgentId?: string | null;
}

export function tasksDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "tasks");
}

function taskFilePath(repoRoot: string, id: string): string {
  // id порождается здесь же (штамп времени + суффикс), посторонние имена не читаются
  return path.join(tasksDir(repoRoot), `${id}.json`);
}

/** Идентификатор задачи: штамп времени + короткий суффикс (безопасен как имя файла). */
export function newTaskId(at = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Первая строка текста - заголовок задачи (без переносов, до 140 символов). */
export function taskTitle(text: string): string {
  const line = text.trim().split("\n", 1)[0] ?? "";
  return line.slice(0, 140) || "задача";
}

/** Последний выданный штамп старта: задачи одной миллисекунды получают монотонно растущие startedAt. */
let lastStartedAtMs = 0;

/** Записать мету запущенной задачи. Ошибка записи не мешает самой задаче. */
export async function saveTaskMeta(repoRoot: string, info: TaskLaunchInfo, id = newTaskId()): Promise<string> {
  const startedMs = Math.max(Date.now(), lastStartedAtMs + 1);
  lastStartedAtMs = startedMs;
  const meta: TaskMeta = {
    id,
    ...info,
    status: "running",
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: null,
    logStartOffset: info.logFile ? await fileSize(info.logFile) : 0,
  };
  try {
    await mkdir(tasksDir(repoRoot), { recursive: true });
    await atomicWrite(taskFilePath(repoRoot, id), `${JSON.stringify(meta, null, 2)}\n`);
  } catch {
    /* реестр недоступен - задача продолжает работать без записи */
  }
  return id;
}

/** Дописать статус существующей задачи (финализация из процесса задачи). */
export async function finishTaskMeta(
  repoRoot: string,
  id: string,
  status: Exclude<TaskStatus, "running">,
): Promise<void> {
  try {
    const file = taskFilePath(repoRoot, id);
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<TaskMeta>;
    if (raw.status !== "running") return;
    await atomicWrite(file, `${JSON.stringify({ ...raw, status, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    /* меты нет - нечего финализировать */
  }
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

/** Прочитать все меты (новые сверху); повреждённые файлы пропускаются. */
export async function readTaskMetas(repoRoot: string): Promise<TaskMeta[]> {
  let names: string[];
  try {
    names = await readdir(tasksDir(repoRoot));
  } catch {
    return [];
  }
  const metas: TaskMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(tasksDir(repoRoot), name), "utf8")) as Partial<TaskMeta>;
      if (typeof raw.id !== "string" || typeof raw.kind !== "string" || typeof raw.startedAt !== "string") continue;
      metas.push({
        id: raw.id,
        kind: raw.kind as TaskKind,
        title: raw.title ?? "задача",
        executor: raw.executor ?? { type: "tool", id: "?" },
        model: raw.model ?? null,
        pid: typeof raw.pid === "number" ? raw.pid : null,
        status: (raw.status ?? "running") as TaskStatus,
        startedAt: raw.startedAt,
        finishedAt: raw.finishedAt ?? null,
        sessionRuntime: raw.sessionRuntime ?? null,
        logFile: raw.logFile ?? null,
        logStartOffset: typeof raw.logStartOffset === "number" ? raw.logStartOffset : 0,
        detail: raw.detail ?? null,
      });
    } catch {
      /* повреждённая мета не ломает список */
    }
  }
  metas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return metas;
}

/** Патерны ошибок в логе с момента старта - признак failed вместо completed. */
const FAILURE_PATTERNS: Record<TaskKind, RegExp[]> = {
  prompt: [/Failed to authenticate/i, /Model creation failed/i, /KEY_MISSING|API key .*required/i],
  "openwiki-build": [/^error:/mi, /Interrupted OpenWiki run/i, /Received tool input did not match/i, /Invalid input: expected/i],
  "graphify-build": [/^error:/mi],
  "graphify-wiki": [/^error:/mi],
};

/**
 * Ленивая финализация: для running-задач с pid - жив ли процесс; лог с момента
 * старта проверяется на ошибки. Provider-задачи (pid null) финализируются сами;
 * зависшие без финализации дольше STALE_MS помечаются interrupted.
 * Возвращает обновлённый список (новые сверху).
 */
export async function finalizeTaskStatuses(repoRoot: string, now = new Date()): Promise<TaskMeta[]> {
  const metas = await readTaskMetas(repoRoot);
  for (const meta of metas) {
    if (meta.status !== "running") continue;
    if (meta.pid !== null) {
      if (processAlive(meta.pid)) continue;
      const failed = meta.logFile ? await logHasFailure(meta, now) : false;
      await finishTaskMeta(repoRoot, meta.id, failed ? "failed" : "completed");
      meta.status = failed ? "failed" : "completed";
      meta.finishedAt = new Date().toISOString();
      continue;
    }
    // задача в процессе консоли: после рестарта сервера финализации не будет
    const ageMs = now.getTime() - Date.parse(meta.startedAt);
    if (Number.isFinite(ageMs) && ageMs > STALE_RUNNING_MS) {
      await finishTaskMeta(repoRoot, meta.id, "interrupted");
      meta.status = "interrupted";
      meta.finishedAt = now.toISOString();
    }
  }
  void pruneOldMetas(repoRoot, metas, now);
  return metas;
}

/** Потолок "зависшей" in-process задачи: 5-минутный таймаут запроса + запас. */
export const STALE_RUNNING_MS = 15 * 60_000;

/** Хвост лога для поиска ошибок: не более 64 КБ от смещения старта задачи. */
const LOG_READ_LIMIT = 64 * 1024;

async function logHasFailure(meta: TaskMeta, _now: Date): Promise<boolean> {
  if (!meta.logFile) return false;
  try {
    const fh = await open(meta.logFile, "r");
    try {
      const size = (await fh.stat()).size;
      const start = Math.max(meta.logStartOffset, size - LOG_READ_LIMIT);
      const length = Math.min(size - start, LOG_READ_LIMIT);
      if (length <= 0) return false;
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, start);
      const text = buf.toString("utf8");
      return FAILURE_PATTERNS[meta.kind]?.some((re) => re.test(text)) ?? false;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

/** Меты старше 30 дней удаляются (best-effort, при каждом чтении списка). */
async function pruneOldMetas(repoRoot: string, metas: TaskMeta[], now: Date): Promise<void> {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60_000;
  for (const meta of metas) {
    if (meta.status === "running") continue;
    const at = Date.parse(meta.finishedAt ?? meta.startedAt);
    if (!Number.isFinite(at) || at >= cutoff) continue;
    await unlink(taskFilePath(repoRoot, meta.id)).catch(() => undefined);
  }
}

/** DTO задачи для вкладки "Мониторинг → Задачи": подписи исполнителя и ссылка. */
export interface TaskDTO extends TaskMeta {
  /** Человекочитаемое имя исполнителя: рантайм, провайдер или инструмент. */
  executorLabel: string;
  /** Ссылка на сессию (/runtime/<id>?tab=sessions) или раздел инструмента. */
  sessionHref: string | null;
}
