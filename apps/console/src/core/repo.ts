import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Корень репозитория harness: каталог, содержащий .agents/runtime/config.json.
 * Walk-up от cwd работает и из apps/console (next dev/build), и из корня.
 * Переопределяется переменной HARNESS_ROOT (тесты/нестандартный запуск).
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  if (process.env.HARNESS_ROOT) return resolve(process.env.HARNESS_ROOT);
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, ".agents", "runtime", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}
