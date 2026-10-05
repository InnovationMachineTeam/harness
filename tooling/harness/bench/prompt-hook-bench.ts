import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Замер приёмки 2: 20 промптов (10 структурных вопросов, 10 технических текстов),
// прямой codegraph prompt-hook против обёртки cli.ts. Средний вывод обёртки
// ожидается не больше половины прямого, контекст структурных вопросов сохраняется.
const ROOT = resolve(import.meta.dir, "..", "..", "..");
const CLI = resolve(import.meta.dir, "..", "src", "cli.ts");

const STRUCTURAL = [
  "Как устроена архитектура консоли и где обрабатываются рантаймы?",
  "Где в консоли реализована установка инструментов и какие шаги выполняет установщик graphify?",
  "Как работает MCP-синк и какие таргеты он поддерживает?",
  "Где формируется дашборд Headroom и как консоль проксирует его API?",
  "Какие проверки выполняет guard и как устроены правила блокировки?",
  "Где описан формат state.json и какие кеши использует консоль?",
  "Как устроен реестр инструментов и что делает projectInit для codegraph?",
  "Где консоль читает статусы сессий рантаймов и как определяется awaiting?",
  "Как устроены плагины инструментов и какие поля обязательны в ToolDef?",
  "Где реализовано создание задач и промпт 'Исправить' в консоли?",
];

const TECHNICAL = [
  "<bash-input>bun test</bash-input>\n<bash-stdout>error: Cannot find module core/tools</bash-stdout>",
  "<bash-input>git status</bash-input>\n<bash-stdout>On branch main, nothing to commit</bash-stdout>",
  "<task-notification>фоновая задача завершена с кодом 0</task-notification>",
  "<bash-input>npm run build</bash-input>\n<bash-stdout>exit code 1 TS2322 types differ</bash-stdout>",
  "<bash-stdout>Warning: deprecated option --legacy-peer-deps</bash-stdout>",
  "<bash-input>ls .agents/runtime</bash-input>\n<bash-stdout>claude codex cursor</bash-stdout>",
  "ok",
  "продолжай",
  "fix",
  "почему?",
];

interface Row {
  prompt: string;
  kind: "структурный" | "технический";
  direct: number;
  wrapped: number;
  kept: boolean;
}

function directBytes(prompt: string): number {
  const result = spawnSync("codegraph", ["prompt-hook"], { input: JSON.stringify({ prompt }), encoding: "utf8", cwd: ROOT });
  return Buffer.byteLength(result.stdout ?? "", "utf8");
}

function wrappedRow(prompt: string): { bytes: number; kept: boolean } {
  const result = spawnSync("bun", [CLI, "codegraph", "prompt-hook"], { input: JSON.stringify({ prompt }), encoding: "utf8", cwd: ROOT });
  const out = result.stdout ?? "";
  return { bytes: Buffer.byteLength(out, "utf8"), kept: out.includes("<codegraph_context") };
}

const rows: Row[] = [];
for (const [kind, prompts] of [
  ["структурный", STRUCTURAL],
  ["технический", TECHNICAL],
] as const) {
  for (const prompt of prompts) {
    const direct = directBytes(prompt);
    const wrapped = wrappedRow(prompt);
    rows.push({ prompt, kind, direct, wrapped: wrapped.bytes, kept: wrapped.kept });
  }
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const structural = rows.filter((row) => row.kind === "структурный");
const technical = rows.filter((row) => row.kind === "технический");
const avg = (values: number[]): number => (values.length ? Math.round(sum(values) / values.length) : 0);

console.log("промпт                       | прямой | обёртка | контекст");
for (const row of rows) {
  const label = row.prompt.replace(/\s+/g, " ").slice(0, 27).padEnd(27);
  console.log(`${label} | ${String(row.direct).padStart(6)} | ${String(row.wrapped).padStart(7)} | ${row.kind === "структурный" ? (row.kept ? "да" : "НЕТ") : "-"}`);
}

const directAvgAll = avg(rows.map((row) => row.direct));
const wrappedAvgAll = avg(rows.map((row) => row.wrapped));
const directAvgStructural = avg(structural.map((row) => row.direct));
const wrappedAvgStructural = avg(structural.map((row) => row.wrapped));
const keptCount = structural.filter((row) => row.kept).length;

console.log(`\nсредний вывод, все 20: прямой ${directAvgAll} Б, обёртка ${wrappedAvgAll} Б (x${(directAvgAll / Math.max(1, wrappedAvgAll)).toFixed(2)})`);
console.log(`средний вывод, структурные: прямой ${directAvgStructural} Б, обёртка ${wrappedAvgStructural} Б`);
console.log(`контекст структурных вопросов сохранён: ${keptCount}/10`);
