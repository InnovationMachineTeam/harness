import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Job-менеджер последовательности команд инструментов (установка/удаление/
 * переключение): шаги выполняются по очереди без оболочки, вывод стримится
 * в UI (SSE /api/tools/job), ввод можно передать в stdin (интерактивные
 * установщики вроде graphify install). Обобщение core/installJobs.ts.
 *
 * Вывод и статус дублируются на диск (.agents/console/tool-jobs/<id>.log/.json):
 * в dev у каждого route-бандла своя копия модуля, и in-memory Map у SSE-роута
 * пуста ("только ожидание вывода"). SSE-роут читает файлы - инвариантно к HMR.
 */

export interface ToolJobStep {
  /** Заголовок шага в терминале (перед командой). */
  label: string;
  command: string[];
  /** Каталог запуска (по умолчанию - корень репозитория). */
  cwd?: string;
  /** Проваленный шаг не останавливает цепочку (для best-effort шагов). */
  optional?: boolean;
  /**
   * Долгоживущий процесс (прокси/сервер): спавнится detached, шаг считается
   * успешным сразу, завершение процесса не ждётся.
   */
  detached?: boolean;
  /** Стабильный идентификатор шага (обновления: id записи реестра) - в results и метах. */
  stepId?: string;
}

/** Итог выполненного шага (код выхода; null - процесс не запустился или убит сигналом). */
export interface ToolJobStepResult {
  stepId?: string;
  label: string;
  exitCode: number | null;
}

export interface ToolJob {
  id: string;
  toolId: string;
  action: string;
  lines: string[];
  done: boolean;
  exitCode: number | null;
  /** Итоги выполненных шагов (накапливаются; попадают в jobs-meta.jsonl). */
  results: ToolJobStepResult[];
  startedAt: number;
  listeners: Set<(line: string) => void>;
}

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

// N-5: установщики индексов (graphify install, codegraph install, serena init)
// переписывают файлы хуков рантаймов - вокруг их шагов файлы хуков
// восстанавливаются к состоянию до шага.
const PROTECTED_HOOK_FILES = [".claude/settings.json", ".codex/hooks.json", ".cursor/hooks.json"];
const INDEX_INSTALLERS = new Set(["codegraph", "graphify", "serena"]);

// Путь строго внутри корня: resolve + boundary-проверка (образец - cleanupAfterUninstall).
function protectedPath(root: string, rel: string): string | null {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, rel);
  return target === rootPath || target.startsWith(rootPath + path.sep) ? target : null;
}

function snapshotHookFiles(root: string): Map<string, string | null> {
  const snapshot = new Map<string, string | null>();
  for (const rel of PROTECTED_HOOK_FILES) {
    const file = protectedPath(root, rel);
    if (!file) continue;
    try {
      snapshot.set(rel, readFileSync(file, "utf8"));
    } catch {
      snapshot.set(rel, null);
    }
  }
  return snapshot;
}

function restoreHookFiles(root: string, snapshot: Map<string, string | null>): boolean {
  let changed = false;
  for (const [rel, before] of snapshot) {
    const file = protectedPath(root, rel);
    if (!file) continue;
    let current: string | null = null;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      current = null;
    }
    if (current === before) continue;
    try {
      if (before === null) {
        rmSync(file, { force: true });
      } else if (current === null) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, before);
      } else {
        writeFileSync(file, before);
      }
      changed = true;
    } catch {
      /* восстановление не должно ломать цепочку шагов */
    }
  }
  return changed;
}

const jobs = new Map<string, ToolJob>();

/** Безопасный алфавит id job'а (генерируется модулем). */
const JOB_ID_RE = /^[A-Za-z0-9-]+$/;

let jobsDir = "";

/** Имена файлов - литеральные константы (динамических компонентов пути нет). */
const JOBS_LOG_NAME = "jobs.log";
const JOBS_META_NAME = "jobs-meta.jsonl";
/** Ротация: лог больше этого размера переименовывается в *.old при новом job'е. */
const JOBS_LOG_ROTATE_BYTES = 8 * 1024 * 1024;

/** Каталог файлового лога job'ов (инициализируется при старте первого job'а). */
export function initToolJobsDir(repoRoot: string): string {
  jobsDir = path.join(repoRoot, ".agents", "console", "tool-jobs");
  mkdirSync(jobsDir, { recursive: true });
  return jobsDir;
}

/**
 * Пути файлового лога job'ов. Имена файлов - литеральные константы, jobId в
 * пути не участвует (строки помечаются префиксом `<id>\t`) - path-traversal
 * исключён по построению.
 */
export function toolJobFiles(repoRoot: string): { log: string; meta: string } {
  const dir = path.join(repoRoot, ".agents", "console", "tool-jobs");
  return { log: path.join(dir, JOBS_LOG_NAME), meta: path.join(dir, JOBS_META_NAME) };
}

function push(job: ToolJob, line: string): void {
  job.lines.push(line);
  if (job.lines.length > 400) job.lines.shift();
  const file = jobsDir ? path.join(jobsDir, JOBS_LOG_NAME) : null;
  if (file) {
    try {
      appendFileSync(file, `${job.id}\t${line}\n`);
    } catch {
      /* файловый лог не критичен для выполнения */
    }
  }
  for (const listener of job.listeners) listener(line);
}

function writeMeta(job: ToolJob): void {
  const file = jobsDir ? path.join(jobsDir, JOBS_META_NAME) : null;
  if (!file) return;
  try {
    appendFileSync(
      file,
      `${JSON.stringify({
        id: job.id,
        toolId: job.toolId,
        action: job.action,
        done: job.done,
        exitCode: job.exitCode,
        results: job.results,
      })}\n`,
    );
  } catch {
    /* файловый статус не критичен для выполнения */
  }
}

/**
 * Запустить цепочку шагов. onDone вызывается один раз по завершении с итоговым
 * кодом (0 - все обязательные шаги успешны); выполняется в фоне после done.
 */
export function startToolJob(opts: {
  toolId: string;
  action: string;
  steps: ToolJobStep[];
  defaultCwd: string;
  onDone?: (exitCode: number | null) => void;
}): ToolJob | { error: string } {
  if (opts.steps.length === 0) return { error: "нет шагов для выполнения" };
  initToolJobsDir(opts.defaultCwd);
  // ротация единого лога: перерос лимит - уезжает в jobs.log.old
  try {
    const logFile = path.join(jobsDir, JOBS_LOG_NAME);
    if (statSync(logFile).size > JOBS_LOG_ROTATE_BYTES) renameSync(logFile, `${logFile}.old`);
  } catch {
    /* лога ещё нет */
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: ToolJob = {
    id,
    toolId: opts.toolId,
    action: opts.action,
    lines: [],
    done: false,
    exitCode: null,
    results: [],
    startedAt: Date.now(),
    listeners: new Set(),
  };
  jobs.set(id, job);
  writeMeta(job); // статус на диске до первых строк - SSE видит job сразу

  const runNext = (index: number, failCode: number | null): void => {
    if (failCode !== null || index >= opts.steps.length) {
      // проваленных шагов нет - цепочка успешна, итоговый код 0 (не null)
      const final = failCode ?? 0;
      job.done = true;
      job.exitCode = final;
      push(job, final === 0 ? "── готово ──" : `── завершено с кодом ${final} ──`);
      writeMeta(job);
      for (const listener of job.listeners) listener("");
      opts.onDone?.(final);
      return;
    }
    const step = opts.steps[index];
    // итог шага фиксируется один раз при его завершении (в т.ч. ошибка запуска)
    const recordResult = (exitCode: number | null): void => {
      job.results.push({ stepId: step.stepId, label: step.label, exitCode });
    };
    push(job, `── ${step.label} ──`);
    push(job, `$ ${step.command.join(" ")}`);
    if (step.detached) {
      // долгоживущий сервис: отвязанный процесс, шаг успешен сразу
      let detachedChild: ChildProcess;
      try {
        detachedChild = spawn(step.command[0], step.command.slice(1), {
          cwd: step.cwd ?? opts.defaultCwd,
          env: process.env,
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (err) {
        push(job, `ошибка запуска ${step.command[0]}: ${String(err)}`);
        recordResult(1);
        runNext(index + 1, step.optional ? null : 1);
        return;
      }
      detachedChild.unref();
      push(job, "(фоновый сервис запущен - завершение не ждём)");
      recordResult(0);
      runNext(index + 1, null);
      return;
    }
    let child: ChildProcess;
    const protectHooks = INDEX_INSTALLERS.has(step.command[0] ?? "");
    const hookSnapshot = protectHooks ? snapshotHookFiles(opts.defaultCwd) : null;
    const restoreHooks = (): void => {
      if (!hookSnapshot) return;
      if (restoreHookFiles(opts.defaultCwd, hookSnapshot)) {
        push(job, "(файлы хуков рантаймов восстановлены - установщик их менять не должен)");
      }
    };
    try {
      child = spawn(step.command[0], step.command.slice(1), {
        cwd: step.cwd ?? opts.defaultCwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      restoreHooks();
      push(job, `ошибка запуска ${step.command[0]}: ${String(err)}`);
      recordResult(1);
      runNext(index + 1, step.optional ? null : 1);
      return;
    }
    (job as ToolJob & { child?: ChildProcess }).child = child;
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(ANSI_RE, "");
      for (const line of text.split("\r\n").join("\n").split("\n")) {
        if (line.trim()) push(job, line.trimEnd());
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (err) => {
      restoreHooks();
      push(job, `ошибка: ${String(err.message ?? err)}`);
      recordResult(1);
      runNext(index + 1, step.optional ? null : 1);
    });
    child.on("close", (code) => {
      restoreHooks();
      recordResult(code);
      if (code === 0) {
        runNext(index + 1, null);
      } else if (step.optional) {
        push(job, `(шаг необязательный - продолжаем, код ${code})`);
        runNext(index + 1, null);
      } else {
        runNext(index + 1, code);
      }
    });
  };

  runNext(0, null);
  scheduleCleanup();
  return job;
}

/** Передать строку в stdin текущего процесса (интерактивные вопросы CLI). */
export function writeToolJobInput(jobId: string, text: string): boolean {
  const job = jobs.get(jobId) as (ToolJob & { child?: ChildProcess }) | undefined;
  if (!job?.child || job.done) return false;
  job.child.stdin?.write(`${text}\n`);
  push(job, `› ${text}`);
  return true;
}

export function getToolJob(jobId: string): ToolJob | undefined {
  return jobs.get(jobId);
}

/** Джобы хранятся 10 минут после завершения - хватает на дочитывание стрима. */
let cleanupScheduled = false;
function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setInterval(
    () => {
      const cutoff = Date.now() - 10 * 60_000;
      for (const [id, job] of jobs) {
        if (job.done && job.startedAt < cutoff) jobs.delete(id);
      }
    },
    60_000,
  ).unref();
}
