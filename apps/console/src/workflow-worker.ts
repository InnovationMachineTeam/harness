import { statSync } from "node:fs";
import path from "node:path";
import { runWorkflowWorker } from "./core/workflows/worker-loop";

// Единственный спавнер (core/workflows/worker.ts) запускает воркер с
// cwd = repoRoot и тем же путём в argv. Рабочим корнем принимается только
// каталог запуска: путь из argv не попадает в файловые операции.
const arg = process.argv[2];
if (!arg) {
  process.stderr.write("workflow worker: repo root не указан\n");
  process.exit(1);
}
const expected = path.resolve(arg);
if (!statSync(expected, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("workflow worker: каталог не найден: " + expected + "\n");
  process.exit(1);
}
if (expected !== process.cwd()) {
  process.stderr.write("workflow worker: запуск выполняется с cwd = корню репозитория\n");
  process.exit(1);
}
await runWorkflowWorker(process.cwd());
