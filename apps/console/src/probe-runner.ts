import { statSync } from "node:fs";
import path from "node:path";
import { runProbeJob } from "./core/probing";

// Единственный спавнер (core/probing.ts startProbeRun) запускает раннер с
// cwd = repoRoot и тем же путём в argv. Рабочим корнем принимается только
// каталог запуска: путь из argv не попадает в файловые операции.
const [arg, probeId] = process.argv.slice(2);
if (!arg || !probeId) {
  process.stderr.write("probe runner: нужны аргументы <repo root> <probe id>\n");
  process.exit(1);
}
const expected = path.resolve(arg);
if (!statSync(expected, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("probe runner: каталог не найден: " + expected + "\n");
  process.exit(1);
}
if (expected !== process.cwd()) {
  process.stderr.write("probe runner: запуск выполняется с cwd = корню репозитория\n");
  process.exit(1);
}
await runProbeJob(process.cwd(), probeId);
