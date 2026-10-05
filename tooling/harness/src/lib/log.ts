import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_LOG_BYTES = 1_000_000;
const KEEP_LINES = 2000;

// Формат строки: <iso> <hook> <ms> <bytes> exit=<n> (N-4).
export function logHook(root: string, name: string, ms: number, bytes: number, exitCode: number): void {
  try {
    const dir = join(root, ".agents", ".tmp", "hooks");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "hooks.log");
    rotateIfNeeded(file);
    appendFileSync(file, `${new Date().toISOString()} ${name} ${Math.round(ms)} ${bytes} exit=${exitCode}\n`);
  } catch {
    // журнал не должен влиять на код выхода хука (N-1)
  }
}

function rotateIfNeeded(file: string): void {
  if (!existsSync(file) || statSync(file).size <= MAX_LOG_BYTES) return;
  const lines = readFileSync(file, "utf8").split("\n");
  writeFileSync(file, lines.slice(-KEEP_LINES).join("\n"));
}
