import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectToolCli } from "./tools";
import type { ToolJobStep } from "./toolJobs";

/**
 * Ядро раздела "Реверс" (страница /rea): каталог операций rea, построение
 * job-шагов (терминал - SSE /api/tools/job), реестр анализов и evidence-файлы.
 * Артефакты - .agents/console/rea/ (analyses.jsonl + evidence/<id>.json);
 * результаты для развития - в sources/ (см. docs/operations.md).
 */

/** Операция CLI rea, доступная в разделе. */
export interface ReaOperationDef {
  id: string;
  label: string;
  hint: string;
  /** Группа вкладки: общий анализ или точечный инспектор формата. */
  tab: "analyze" | "inspectors";
  /** Подкоманда CLI (аргументы до пути к цели). */
  args: string[];
}

/** Каталог операций: общий анализ и инспекторы форматов (без внешних движков). */
export const REA_OPERATIONS: ReaOperationDef[] = [
  {
    id: "analyze",
    label: "Общий анализ",
    hint: "Обзор приложения или бинарника: структура, форматы, точки входа; нативные цели требуют провайдера (Ghidra, Hopper, IDA)",
    tab: "analyze",
    args: ["analyze"],
  },
  {
    id: "analyze-javascript-application",
    label: "JS-приложение",
    hint: "Статический граф JavaScript/Electron-приложения без запуска",
    tab: "analyze",
    args: ["analyze-javascript-application"],
  },
  {
    id: "inspect-artifact",
    label: "Артефакт (универсальный)",
    hint: "Godot PCK, UnityFS, ESP-образы, Node SEA, Intel HEX/S-record, U-Boot uImage; извлечение - extract-artifact",
    tab: "inspectors",
    args: ["inspect-artifact"],
  },
  {
    id: "inspect-sqlite-database",
    label: "SQLite",
    hint: "Снимок базы: схема, таблицы, строки (только чтение)",
    tab: "inspectors",
    args: ["inspect-sqlite-database"],
  },
  {
    id: "inspect-pe-certificates",
    label: "PE: сертификаты",
    hint: "Таблицы сертификатов и подписей PE-файла",
    tab: "inspectors",
    args: ["inspect-pe-certificates"],
  },
  {
    id: "inspect-pe-imports",
    label: "PE: импорты",
    hint: "Таблица импортов PE-файла",
    tab: "inspectors",
    args: ["inspect-pe-imports"],
  },
  {
    id: "inspect-pe-load-config",
    label: "PE: load config",
    hint: "Структура load config PE-файла",
    tab: "inspectors",
    args: ["inspect-pe-load-config"],
  },
  {
    id: "inspect-elf-notes",
    label: "ELF: note-секции",
    hint: "Таблицы PT_NOTE и SHT_NOTE",
    tab: "inspectors",
    args: ["inspect-elf-notes"],
  },
  {
    id: "inspect-go-binary",
    label: "Go: метаданные сборки",
    hint: "Встроенные метаданные сборки Go-бинарника",
    tab: "inspectors",
    args: ["inspect-go-binary"],
  },
  {
    id: "inspect-rust-binary",
    label: "Rust: зависимости",
    hint: "Список зависимостей из cargo-auditable секции",
    tab: "inspectors",
    args: ["inspect-rust-binary"],
  },
  {
    id: "inspect-model-artifact",
    label: "Модель: GGUF/safetensors",
    hint: "Заголовки GGUF и safetensors без загрузки весов",
    tab: "inspectors",
    args: ["inspect-model-artifact"],
  },
  {
    id: "inspect-il2cpp-metadata",
    label: "Unity IL2CPP",
    hint: "Имена типов и методов из global-metadata.dat (v24/27/29/31/39)",
    tab: "inspectors",
    args: ["inspect-il2cpp-metadata"],
  },
  {
    id: "inspect-apple-ips",
    label: "Apple: краш-отчёт",
    hint: "Разбор .ips краш-отчёта iOS/macOS",
    tab: "inspectors",
    args: ["inspect-apple-ips"],
  },
  {
    id: "inspect-kernel-module",
    label: "Модуль ядра",
    hint: "Метаданные .ko (gzip/xz/zstd-сжатие не поддерживается)",
    tab: "inspectors",
    args: ["inspect-kernel-module"],
  },
  {
    id: "inspect-python-pyc",
    label: "Python .pyc",
    hint: "Метаданные байткода CPython 3.7-3.13 (без декомпиляции)",
    tab: "inspectors",
    args: ["inspect-python-pyc"],
  },
  {
    id: "inspect-erlang-beam",
    label: "Erlang BEAM",
    hint: "Чанки, атомы, экспортируемые функции BEAM-файла",
    tab: "inspectors",
    args: ["inspect-erlang-beam"],
  },
  {
    id: "inspect-devicetree",
    label: "Devicetree",
    hint: "Разбор FDT-блоба (v16/v17)",
    tab: "inspectors",
    args: ["inspect-devicetree"],
  },
];

export function reaOperationById(id: string): ReaOperationDef | undefined {
  return REA_OPERATIONS.find((op) => op.id === id);
}

/* ------------------------------- артефакты --------------------------------- */

export function reaDataDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "rea");
}

export function reaEvidenceDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "rea", "evidence");
}

export function reaAnalysesFile(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "rea", "analyses.jsonl");
}

/** Запись реестра анализов и сборок сред. */
export interface ReaAnalysis {
  id: string;
  at: string;
  /** analysis - анализ цели; environment - сборка среды из захвата. */
  action: "analysis" | "environment";
  /** id операции каталога или "environment-build". */
  operation: string;
  target: string;
  provider?: string;
  /** Имя среды (только environment). */
  name?: string;
  /** Каталог сборки sources/<имя> (только environment). */
  sourcesDir?: string;
  jobId: string;
  status: "running" | "ok" | "failed";
  exitCode: number | null;
  evidenceFile?: string;
}

export async function readReaAnalyses(repoRoot: string, limit = 50): Promise<ReaAnalysis[]> {
  let text: string;
  try {
    text = await readFile(reaAnalysesFile(repoRoot), "utf8");
  } catch {
    return [];
  }
  const entries: ReaAnalysis[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as ReaAnalysis);
    } catch {
      /* повреждённая строка не блокирует чтение реестра */
    }
  }
  return entries.slice(-limit).reverse();
}

export async function findReaAnalysis(repoRoot: string, id: string): Promise<ReaAnalysis | undefined> {
  const entries = await readReaAnalyses(repoRoot, Number.MAX_SAFE_INTEGER);
  return entries.find((entry) => entry.id === id);
}

async function writeReaAnalyses(repoRoot: string, entries: ReaAnalysis[]): Promise<void> {
  await mkdir(reaDataDir(repoRoot), { recursive: true });
  const file = reaAnalysesFile(repoRoot);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""));
  await rename(tmp, file);
}

export async function appendReaAnalysis(repoRoot: string, entry: ReaAnalysis): Promise<void> {
  await mkdir(reaDataDir(repoRoot), { recursive: true });
  await appendFile(reaAnalysesFile(repoRoot), `${JSON.stringify(entry)}\n`);
}

/** Обновить запись по id (перезапись файла; строка-мусор отбрасывается). */
export async function updateReaAnalysis(repoRoot: string, id: string, patch: Partial<ReaAnalysis>): Promise<void> {
  const file = reaAnalysesFile(repoRoot);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  const entries: ReaAnalysis[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ReaAnalysis;
      entries.push(entry.id === id ? { ...entry, ...patch } : entry);
    } catch {
      /* мусорная строка не переносится */
    }
  }
  await writeReaAnalyses(repoRoot, entries);
}

/* ------------------------------- валидация --------------------------------- */

export type ReaValidation = { ok: true; value: string } | { ok: false; error: string };

/** Цель анализа: абсолютный существующий путь. */
export function validateReaTarget(target: unknown): ReaValidation {
  if (typeof target !== "string" || !target.trim()) return { ok: false, error: "укажите путь к цели" };
  const candidate = target.trim();
  if (!path.isAbsolute(candidate)) return { ok: false, error: "путь должен быть абсолютным" };
  try {
    statSync(candidate);
  } catch {
    return { ok: false, error: `цель не найдена: ${candidate}` };
  }
  return { ok: true, value: candidate };
}

/** Имя среды: kebab-case (требование rea environment-build --name). */
export function validateReaEnvName(name: unknown): ReaValidation {
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "укажите имя среды" };
  const slug = name.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: "имя среды - kebab-case: строчные латинские буквы, цифры, дефис" };
  }
  return { ok: true, value: slug };
}

export function reaEnvSourcesDir(repoRoot: string, slug: string): string {
  return path.join(repoRoot, "sources", slug);
}

/** Каталог сборки среды: отсутствует или пуст (rea ничего не перезаписывает). */
export function validateReaEnvDir(dir: string): { ok: true } | { ok: false; error: string } {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return { ok: true };
  }
  if (!st.isDirectory()) return { ok: false, error: `путь занят файлом: ${dir}` };
  if (readdirSync(dir).length > 0) return { ok: false, error: `каталог не пуст: ${dir}` };
  return { ok: true };
}

/** id записи реестра и evidence-файла (безопасный алфавит). */
export function newReaAnalysisId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------ job-шаги ----------------------------------- */

export function buildReaAnalysisSteps(opts: {
  operation: ReaOperationDef;
  target: string;
  provider?: string;
  evidenceFile: string;
}): ToolJobStep[] {
  const command = ["rea", ...opts.operation.args, opts.target];
  if (opts.provider && opts.provider !== "auto") command.push("--provider", opts.provider);
  command.push("--format", "json");
  return [{ label: opts.operation.label, command, outputFile: opts.evidenceFile, stepId: opts.operation.id }];
}

export function buildReaEnvBuildSteps(opts: {
  harPath: string;
  name: string;
  sourcesDir: string;
  evidenceFile: string;
}): ToolJobStep[] {
  return [
    {
      label: `Сборка среды "${opts.name}"`,
      command: ["rea", "environment-build", opts.harPath, opts.sourcesDir, "--name", opts.name, "--format", "json"],
      outputFile: opts.evidenceFile,
      stepId: "environment-build",
    },
  ];
}

export function buildReaDoctorSteps(): ToolJobStep[] {
  return [
    { label: "Готовность rea и провайдеров", command: ["rea", "doctor", "--json"], stepId: "doctor" },
    { label: "Готовность MCP-сервера", command: ["rea", "mcp", "doctor"], stepId: "mcp-doctor" },
  ];
}

/* ------------------------------- статус ------------------------------------ */

export interface ReaProviderInfo {
  id: string;
  name: string;
}

/** Провайдеры анализа (синхронный снимок, паттерн agentplane-status). */
export function reaProvidersSync(): { providers: ReaProviderInfo[]; error: string | null } {
  const res = spawnSync("rea", ["providers", "--json"], {
    encoding: "utf8",
    timeout: 8000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) {
    return {
      providers: [],
      error: res.error ? String(res.error) : `rea providers завершился с кодом ${res.status}`,
    };
  }
  try {
    const parsed = JSON.parse(res.stdout) as { capabilities?: { provider?: { id?: string; name?: string } }[] };
    const providers = (parsed.capabilities ?? [])
      .map((cap) => ({ id: cap.provider?.id ?? "", name: cap.provider?.name ?? "" }))
      .filter((provider) => provider.id);
    return { providers, error: null };
  } catch {
    return { providers: [], error: "не удалось разобрать вывод rea providers --json" };
  }
}

/** Статус CLI rea (детект и версия - общий кеш core/tools). */
export function reaCliStatus(): { installed: boolean; version: string | null } {
  return detectToolCli("rea");
}
