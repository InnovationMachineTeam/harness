import { spawnSync } from "node:child_process";

/**
 * Git-операции для селекторов вкладки "Агент": статус репозитория, ветки,
 * инициализация и создание ветки. Быстрые синхронные вызовы с таймаутом;
 * каталог проверяется на стороне маршрутов (вхождение в рабочие папки).
 */

export interface GitRepoStatus {
  /** Бинарник git доступен в PATH. */
  gitAvailable: boolean;
  /** Каталог внутри рабочего дерева git-репозитория. */
  isRepo: boolean;
  /** Текущая ветка; null - detached HEAD. */
  current: string | null;
  /** Локальные ветки. */
  branches: string[];
  /** Репозиторий без коммитов (не создан ни один commit). */
  empty: boolean;
}

interface GitRunResult {
  ok: boolean;
  out: string;
  error: string;
}

function run(dir: string, args: string[], timeoutMs = 8000): GitRunResult {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: timeoutMs });
  if (res.error) {
    return { ok: false, out: "", error: res.error.message };
  }
  return {
    ok: res.status === 0,
    out: (res.stdout ?? "").trim(),
    error: (res.stderr ?? "").trim(),
  };
}

/** Бинарник git доступен (which/spawnSync, кеш не нужен - вызов дешёвый). */
export function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { encoding: "utf8", timeout: 3000 }).status === 0;
}

/** Статус репозитория в каталоге; ошибки чтения - "не репозиторий". */
export function gitRepoStatus(dir: string): GitRepoStatus {
  if (!gitAvailable()) {
    return { gitAvailable: false, isRepo: false, current: null, branches: [], empty: false };
  }
  const inside = run(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") {
    return { gitAvailable: true, isRepo: false, current: null, branches: [], empty: false };
  }
  const head = run(dir, ["symbolic-ref", "--short", "HEAD"]);
  const branches = run(dir, ["branch", "--format=%(refname:short)"])
    .out.split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  const headCommit = run(dir, ["rev-parse", "--verify", "HEAD"]);
  return {
    gitAvailable: true,
    isRepo: true,
    current: head.ok ? head.out : null,
    branches,
    empty: !headCommit.ok,
  };
}

/** git init в каталоге; каталог должен существовать (проверяет маршрут). */
export function gitInit(dir: string): { ok: boolean; error: string | null } {
  const res = run(dir, ["init"]);
  return { ok: res.ok, error: res.ok ? null : res.error || "git init не выполнен" };
}

/**
 * Создать ветку и переключиться на неё (git checkout -b).
 * Имя проверяется git check-ref-format; ошибка - текст git.
 */
export function gitCreateBranch(dir: string, name: string): { ok: boolean; error: string | null } {
  const check = gitCheckBranchName(dir, name);
  if (!check.ok) return check;
  const res = run(dir, ["checkout", "-b", check.name!]);
  return { ok: res.ok, error: res.ok ? null : res.error || "ветка не создана" };
}

/** Переключиться на существующую ветку (git checkout <name>). */
export function gitCheckoutBranch(dir: string, name: string): { ok: boolean; error: string | null } {
  const check = gitCheckBranchName(dir, name);
  if (!check.ok) return check;
  const res = run(dir, ["checkout", check.name!]);
  return { ok: res.ok, error: res.ok ? null : res.error || "ветка не переключена" };
}

/** Проверка имени ветки: форма + git check-ref-format; возвращает нормализованное имя. */
function gitCheckBranchName(dir: string, name: string): { ok: boolean; error: string | null; name?: string } {
  const trimmed = name.trim();
  // предварительная проверка формы: без пробелов и управляющих символов,
  // полная - git check-ref-format (правила refs, включая .., ~, ^, .lock)
  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith("-")) {
    return { ok: false, error: "имя ветки: буквы, цифры, . _ / - без пробелов" };
  }
  const check = run(dir, ["check-ref-format", "--branch", trimmed]);
  if (!check.ok) {
    return { ok: false, error: check.error || "имя ветки не проходит git check-ref-format" };
  }
  return { ok: true, error: null, name: trimmed };
}
