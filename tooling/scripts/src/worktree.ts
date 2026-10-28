import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const BASE = resolve(ROOT, ".agents", ".worktrees");

/**
 * Штатное удаление worktree (AGENTS.md §9; вместо rm -rf, который оставляет
 * регистрацию в Git и заблокирован правилом shell.rm-rf-worktree).
 *
 * bun run worktree:remove <slug> [--force]   удалить .agents/.worktrees/<slug>
 * bun run worktree:remove                     список зарегистрированных worktree
 */

function git(args: string[], opts: { input?: string } = {}) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 60_000, ...opts });
}

function listWorktrees(): string[] {
  const result = git(["worktree", "list", "--porcelain"]);
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((dir) => dir.startsWith(BASE + "/"))
    .map((dir) => basename(dir));
}

function remove(slug: string, force: boolean): number {
  const target = resolve(BASE, slug);
  if (!target.startsWith(BASE + "/") || target === BASE) {
    process.stderr.write(`worktree: недопустимый slug "${slug}" - ожидается имя каталога внутри .agents/.worktrees/\n`);
    return 1;
  }
  const registered = listWorktrees().includes(basename(target));
  if (!registered && !existsSync(target)) {
    process.stderr.write(`worktree: "${slug}" не найден в .agents/.worktrees/\n`);
    return 1;
  }
  // Незарегистрированный остаток каталога: чистим регистрацию и выходим.
  if (!registered) {
    git(["worktree", "prune"]);
    process.stdout.write(`worktree: "${slug}" не зарегистрирован в Git; регистрация очищена, каталог удалите после проверки содержимого\n`);
    return 0;
  }
  const result = git(["worktree", "remove", ...(force ? ["--force"] : []), target]);
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || "").trim();
    process.stderr.write(`worktree: git worktree remove не выполнен - ${message.slice(0, 300)}\n`);
    process.stderr.write(force ? "" : "worktree: у worktree есть незакоммиченные изменения - проверьте их и повторите с --force\n");
    return 1;
  }
  git(["worktree", "prune"]);
  process.stdout.write(`worktree: "${slug}" удалён\n`);
  return 0;
}

function main(): number {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const slug = args.find((item) => item !== "--force");
  if (!slug) {
    const items = listWorktrees();
    if (!items.length) {
      process.stdout.write("worktree: зарегистрированных worktree в .agents/.worktrees/ нет\n");
      return 0;
    }
    process.stdout.write(["worktree: используйте bun run worktree:remove <slug> [--force]", ...items.map((item) => "  " + item)].join("\n") + "\n");
    return 0;
  }
  return remove(slug, force);
}

process.exit(main());
