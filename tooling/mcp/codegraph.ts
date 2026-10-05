#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isAlive } from "../harness/src/lib/limits";

// Обёртка codegraph для init и index (C-4): при живом writer.pid база не
// открывается, команда завершается с ошибкой. Запуск в каталоге проекта:
// bun tooling/mcp/codegraph.ts init|index. Остальные подкоманды - напрямую
// через codegraph.

const sub = process.argv[2];
const settings = { stdio: "inherit" as const, cwd: process.cwd() };

switch (sub) {
  case "init":
  case "index": {
    const lockPid = writerLockPid();
    if (lockPid !== null) {
      process.stderr.write(
        `codegraph: база занята - .codegraph/writer.pid держит живой PID ${lockPid} (fallback-режим). ` +
          `Перезапустите сессию codegraph или выполните "codegraph unlock". Запись в базу не выполнялась.\n`,
      );
      process.exit(1);
    }
    process.exit(sub === "init" ? spawnSync("codegraph", ["init"], settings).status ?? 1 : spawnSync("codegraph", ["index"], settings).status ?? 1);
  }
  default:
    process.stderr.write("обёртка поддерживает только подкоманды init и index - остальное вызывайте напрямую (codegraph <команда>)\n");
    process.exit(2);
}

function writerLockPid(): number | null {
  const pidFile = join(process.cwd(), ".codegraph", "writer.pid");
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
}
