import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function sessionDir(root: string, sessionId?: string): string {
  const id = (sessionId || `adhoc-${new Date().toISOString().slice(0, 10)}`).replace(/[^A-Za-z0-9._-]/g, "_");
  return join(root, ".agents", ".tmp", "hooks", id);
}

export function hasFlag(dir: string, name: string): boolean {
  return existsSync(join(dir, name));
}

export function setFlag(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), new Date().toISOString());
}

export function bumpCounter(dir: string, name: string): number {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const current = existsSync(file) ? parseInt(readFileSync(file, "utf8"), 10) || 0 : 0;
  writeFileSync(file, String(current + 1));
  return current + 1;
}
