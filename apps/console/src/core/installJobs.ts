import { spawn, type ChildProcess } from "node:child_process";

/**
 * Job-менеджер установки навыков через `bunx skills add <pkg> -y`
 * (cwd = корень репозитория; CLI кладёт навык в .agents/skills/<name>,
 * делает симлинки в найденные каталоги агентов и пишет skills-lock.json).
 * Вывод стримится в UI (SSE), ввод можно передать в stdin процесса.
 */

export interface InstallJob {
  id: string;
  pkg: string;
  lines: string[];
  done: boolean;
  exitCode: number | null;
  startedAt: number;
  listeners: Set<(line: string) => void>;
}

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

const jobs = new Map<string, InstallJob>();

/** Идентификатор пакета skills.sh: owner/repo, имя или pack-URL. */
export function isValidSkillPackage(pkg: string): boolean {
  if (pkg.startsWith("https://skills.sh/p/")) return /^https:\/\/skills\.sh\/p\/[A-Za-z0-9._-]+$/.test(pkg);
  return /^[A-Za-z0-9][A-Za-z0-9@/._-]{0,120}$/.test(pkg) && !pkg.includes("..");
}

function push(job: InstallJob, line: string): void {
  job.lines.push(line);
  if (job.lines.length > 400) job.lines.shift();
  for (const listener of job.listeners) listener(line);
}

export function startInstallJob(repoRoot: string, pkg: string): InstallJob | { error: string } {
  if (!isValidSkillPackage(pkg)) return { error: "недопустимое имя пакета" };
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: InstallJob = {
    id,
    pkg,
    lines: [],
    done: false,
    exitCode: null,
    startedAt: Date.now(),
    listeners: new Set(),
  };
  jobs.set(id, job);

  const child: ChildProcess = spawn("bunx", ["skills", "add", pkg, "-y"], {
    cwd: repoRoot,
    env: { ...process.env, DISABLE_TELEMETRY: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8").replace(ANSI_RE, "");
    for (const line of text.split("\r\n").join("\n").split("\n")) {
      if (line.trim()) push(job, line.trimEnd());
    }
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  child.on("close", (code) => {
    job.done = true;
    job.exitCode = code;
    push(job, code === 0 ? "── установка завершена ──" : `── процесс завершился с кодом ${code} ──`);
    for (const listener of job.listeners) listener("");
  });
  child.on("error", (err) => {
    job.done = true;
    push(job, `ошибка запуска bunx: ${String(err)}`);
  });
  scheduleCleanup();
  (job as InstallJob & { child?: ChildProcess }).child = child;
  return job;
}

/** Передать строку в stdin процесса (интерактивные вопросы CLI, если возникнут). */
export function writeJobInput(jobId: string, text: string): boolean {
  const job = jobs.get(jobId) as (InstallJob & { child?: ChildProcess }) | undefined;
  if (!job?.child || job.done) return false;
  job.child.stdin?.write(`${text}\n`);
  push(job, `› ${text}`);
  return true;
}

export function getJob(jobId: string): InstallJob | undefined {
  return jobs.get(jobId);
}

/** Джобы хранятся 10 минут после завершения - хватает на дочитывание стрима.
 *  Один интервал очистки на модуль, не на джоб. */
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
