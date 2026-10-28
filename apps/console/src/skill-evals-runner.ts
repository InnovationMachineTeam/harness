import { statSync } from "node:fs";
import path from "node:path";
import { runSkillEvalsJob } from "./core/skillEvals";

// Единственный спавнер (core/skillEvals.ts startSkillEvalsRun) запускает раннер
// с cwd = repoRoot и тем же путём в argv. Рабочим корнем принимается только
// каталог запуска: путь из argv не попадает в файловые операции.
const [arg, jobId] = process.argv.slice(2);
if (!arg || !jobId) {
  process.stderr.write("skill-evals runner: нужны аргументы <repo root> <job id>\n");
  process.exit(1);
}
const expected = path.resolve(arg);
if (!statSync(expected, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("skill-evals runner: каталог не найден: " + expected + "\n");
  process.exit(1);
}
if (expected !== process.cwd()) {
  process.stderr.write("skill-evals runner: запуск выполняется с cwd = корню репозитория\n");
  process.exit(1);
}
await runSkillEvalsJob(process.cwd(), jobId);
