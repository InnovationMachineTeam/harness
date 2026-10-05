#!/usr/bin/env bun
// CLI ASR-прогона. Живой запуск требует настроенного провайдера
// (.agents/providers/<id>/, как в консоли) или --env с API-ключом.
// Использование:
//   bun apps/console/scripts/asr.ts --provider <id> [--model <name>] [--limit N]
//     [--class <csv>] [--judge-provider <id>] [--judge-model <name>]
//     [--env <VAR> --base-url <url>] [--threshold 0.3] [--out <path>]
// Exit 0 - защищённая ASR не выше порога; exit 2 - выше порога.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAsr, type AsrModeTotals, type AsrReport } from "../src/core/asr";

const pct = (part: AsrModeTotals): string => `${part.compromised}/${part.attempts} (${(part.asr * 100).toFixed(0)}%)`;

function printReport(report: AsrReport): void {
  console.log(`ASR-прогон: провайдер ${report.provider}, модель ${report.model}, судья ${report.judgeModel}`);
  console.log(`Итого: без защиты ${pct(report.totals.unguarded)}, с защитой ${pct(report.totals.guarded)}, порог ${(report.threshold * 100).toFixed(0)}%`);
  console.log("Класс\tБез защиты\tС защитой");
  for (const row of report.byClass) console.log(`${row.class}\t${pct(row.unguarded)}\t${pct(row.guarded)}`);
  for (const row of report.rows) {
    if (row.guarded.compromised) console.error(`ПРОБОЙ ЗАЩИТЫ ${row.id}: утечки ${row.guarded.leaks.join(", ")}; судья: ${row.guarded.judgeReason ?? "-"}`);
  }
}

async function main(): Promise<never> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const provider = value("--provider");
  if (!provider) {
    console.error("scan-asr: укажите --provider <id> (пресеты providers.ts); токен берётся из .agents/providers/<id>/ или из --env <VAR>");
    process.exit(1);
  }
  const report = await runAsr({
    provider,
    model: value("--model"),
    judgeProvider: value("--judge-provider"),
    judgeModel: value("--judge-model"),
    envKey: value("--env"),
    baseUrl: value("--base-url"),
    classes: value("--class")?.split(",").map((item) => item.trim()).filter(Boolean),
    limit: value("--limit") ? Number(value("--limit")) : undefined,
    threshold: value("--threshold") ? Number(value("--threshold")) : undefined,
  });

  printReport(report);
  const out = value("--out") ?? resolve(".agents/.tmp/asr/report.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  console.log(`Отчёт: ${out}`);
  process.exit(report.totals.guarded.asr > report.threshold ? 2 : 0);
}

await main();
