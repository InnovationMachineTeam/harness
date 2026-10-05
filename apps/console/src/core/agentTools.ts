import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isActiveProvider, parseTaskProviderId, providerPresetById, type ProviderEntry, type ProviderPreset } from "./providers";
import { readProviderEntry } from "./providerSettings";
import type { ConsoleState } from "./state";
import type { McpServerDef } from "./types";

/**
 * Встроенные инструменты агентного цикла (function calling): read_file,
 * list_dir, run_command. Схемы аргументов отдаются модели в запросе, текст
 * результата возвращается в контекст следующей итерации. Исполнители
 * изолированы рабочей папкой вызова; run_command перед исполнением проходит
 * guard-политику репозитория (.guardrails/src/cli.ts). Инструменты
 * никогда не бросают исключение - ошибка возвращается модели как текст
 * результата, чтобы цикл мог скорректировать вызов.
 */

/** JSON-схема инструмента (общая для всех диалектов провайдеров). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Контекст исполнения: рабочая папка и корень репозитория (для guard). */
export interface ToolContext {
  cwd: string;
  repoRoot: string;
}

export interface ToolResult {
  ok: boolean;
  /** Текст для модели: вывод инструмента или описание ошибки/блока. */
  output: string;
  /** true - вызов отклонён политикой (guard, секреты, границы папки). */
  blocked: boolean;
  durationMs: number;
}

/** Лимит текста результата инструмента в контексте модели. */
export const MAX_TOOL_OUTPUT = 16 * 1024;

/** Таймаут run_command по умолчанию и потолок. */
export const COMMAND_TIMEOUT_MS = 120_000;
export const COMMAND_TIMEOUT_MAX_MS = 600_000;

/**
 * Секретные пути синхронизированы с Guardrails (`.guardrails/src/rules.ts`,
 * константа SECRET_PATH): .env*, *.pem, *.key, id_rsa/id_ed25519, .ssh/,
 * secrets/, credentials.json.
 */
const SECRET_PATH =
  /(^|\/)\.env($|\.)|\.pem$|\.key$|id_rsa|id_ed25519|(^|\/)\.ssh\/|(^|\/)secrets?\/|credentials\.json$/i;

/* ------------------------------- схемы инструментов ------------------------------- */

export const BUILTIN_TOOL_SPECS: ToolSpec[] = [
  {
    name: "read_file",
    description:
      "Прочитай текстовый файл в рабочей папке. Вернёт содержимое с номерами строк. Большие файлы читай кусками через offset и limit.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь файла относительно рабочей папки." },
        offset: { type: "integer", description: "Номер начальной строки (с 1)." },
        limit: { type: "integer", description: "Число строк (по умолчанию 400, максимум 2000)." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description:
      "Покажи содержимое каталога рабочей папки: имена, типы (каталог/файл), размеры файлов. Для обзора структуры поднимай depth.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь каталога относительно рабочей папки (по умолчанию '.')." },
        depth: { type: "integer", description: "Глубина обхода 1-3 (по умолчанию 1)." },
      },
    },
  },
  {
    name: "run_command",
    description:
      "Выполни shell-команду в рабочей папке и верни stdout со stderr и код выхода. Команда проходит guard-политику репозитория; деструктивные команды будут отклонены.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Команда shell без интерактивного ввода." },
        timeout_ms: { type: "integer", description: `Таймаут в мс, ${COMMAND_TIMEOUT_MS} по умолчанию, максимум ${COMMAND_TIMEOUT_MAX_MS}.` },
      },
      required: ["command"],
    },
  },
];

/* --------------------------------- общие помощники -------------------------------- */

/** Обрезка вывода до лимита: сохраняются начало и конец с маркером усечения. */
export function capToolOutput(text: string, limit = MAX_TOOL_OUTPUT): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  const half = Math.floor(limit / 2);
  const head = text.slice(0, half);
  const tail = text.slice(-half);
  return `${head}\n…[вывод усечён: показаны начало и конец]…\n${tail}`;
}

/**
 * Путь внутри рабочей папки: resolve + проверка префикса + realpath против
 * выхода через символьную ссылку. null - путь выходит за границу.
 */
function resolveContained(cwd: string, target: string): string | null {
  const root = realpathSync(cwd);
  const resolved = path.resolve(root, target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  try {
    const real = realpathSync(resolved);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    return real;
  } catch {
    // Цели ещё нет (новый файл) - границу держит сам resolved.
    return resolved;
  }
}

function toolError(message: string, startedAt: number, blocked = false): ToolResult {
  return { ok: false, output: message, blocked, durationMs: Date.now() - startedAt };
}

/* ------------------------------------ read_file ----------------------------------- */

async function toolReadFile(ctx: ToolContext, rawArgs: unknown, startedAt: number): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as { path?: unknown; offset?: unknown; limit?: unknown };
  const target = typeof args.path === "string" ? args.path.trim() : "";
  if (!target) return toolError("read_file: не указан path", startedAt, true);
  const file = resolveContained(ctx.cwd, target);
  if (!file) return toolError(`read_file: путь вне рабочей папки: ${target}`, startedAt, true);
  const relative = path.relative(ctx.cwd, file).split(path.sep).join("/");
  if (SECRET_PATH.test("/" + relative)) {
    return toolError(`read_file: чтение секретного пути запрещено политикой: ${relative}`, startedAt, true);
  }
  const offset = Number.isInteger(args.offset) && (args.offset as number) > 0 ? (args.offset as number) : 1;
  const limit = Math.min(Number.isInteger(args.limit) && (args.limit as number) > 0 ? (args.limit as number) : 400, 2000);
  const content = await readFile(file, "utf8").catch(() => null);
  if (content === null) return toolError(`read_file: файл не прочитан (нет доступа или это бинарный файл): ${relative}`, startedAt);
  const lines = content.split("\n");
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = slice.map((line, index) => String(offset + index).padStart(6, " ") + "\t" + line).join("\n");
  const suffix = offset - 1 + slice.length < lines.length ? `\n…[файл продолжается: строк ${lines.length}, дальше с offset ${offset + slice.length}]…` : "";
  return { ok: true, output: capToolOutput(numbered + suffix), blocked: false, durationMs: Date.now() - startedAt };
}

/* ------------------------------------ list_dir ------------------------------------ */

async function listLevel(dir: string, relative: string, depth: number, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    out.push(`${relative || "."}: каталог не прочитан`);
    return;
  }
  for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(`${childRelative}/`);
      if (depth > 1) await listLevel(path.join(dir, entry.name), childRelative, depth - 1, out);
    } else if (entry.isFile()) {
      const size = await stat(path.join(dir, entry.name)).then((item) => item.size).catch(() => 0);
      out.push(`${childRelative}  ${size} B`);
    } else {
      out.push(`${childRelative}  (символьная ссылка)`);
    }
  }
}

async function toolListDir(ctx: ToolContext, rawArgs: unknown, startedAt: number): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as { path?: unknown; depth?: unknown };
  const target = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const dir = resolveContained(ctx.cwd, target);
  if (!dir) return toolError(`list_dir: путь вне рабочей папки: ${target}`, startedAt, true);
  const normalized = path.relative(ctx.cwd, dir).split(path.sep).join("/");
  if (SECRET_PATH.test("/" + normalized)) {
    return toolError(`list_dir: секретный путь запрещён политикой: ${normalized || "."}`, startedAt, true);
  }
  const depth = Math.min(Math.max(Number.isInteger(args.depth) && (args.depth as number) > 0 ? (args.depth as number) : 1, 1), 3);
  const out: string[] = [];
  await listLevel(dir, normalized, depth, out);
  if (!out.length) out.push("(каталог пуст)");
  return { ok: true, output: capToolOutput(out.join("\n")), blocked: false, durationMs: Date.now() - startedAt };
}

/* ----------------------------------- run_command ---------------------------------- */

/**
 * Guard-проверка команды: payload контракта PreToolUse в stdin, exit 0 -
 * разрешено, exit 2 - блок (stderr содержит причину и "Instead: ...").
 * Аргументы процесса литеральные: "bun" и относительный путь guard'а,
 * рабочий каталог задаёт cwd - текст команды в argv не попадает.
 */
export function guardVerdict(repoRoot: string, command: string): { allowed: boolean; reason: string } {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const probe = spawnSync("bun", [".guardrails/src/cli.ts", "evaluate"], {
    cwd: repoRoot,
    input: payload,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, AGENT_RUNTIME: "console", GUARDRAILS_INTEGRATION: "code:console:run-command" },
  });
  if (probe.error) {
    // Guard недоступен - запуск запрещён: политика не может быть пропущена.
    return { allowed: false, reason: `guard не выполнен: ${probe.error.message}` };
  }
  if (probe.status === 2) {
    return { allowed: false, reason: (probe.stderr || "команда отклонена политикой").trim() };
  }
  // Контракт guard: 0 - разрешено, 2 - блок; любой иной код - сбой guard'а,
  // трактуется как блок (fail-closed): отсутствующий файл, сбой окружения.
  if (probe.status !== 0) {
    return { allowed: false, reason: `guard завершился с кодом ${probe.status}: ${(probe.stderr || "").trim().slice(0, 300)}` };
  }
  return { allowed: true, reason: (probe.stderr || "").trim() };
}

/**
 * Исполнение команды: `/bin/bash -s`, текст команды подаётся в stdin -
 * argv процесса литеральный, команда не попадает ни в аргументы процесса,
 * ни в список ps. Guard-проверка выполняется до запуска; его блок возвращает
 * модели причину с подсказкой "Instead: ...".
 */
async function toolRunCommand(ctx: ToolContext, rawArgs: unknown, startedAt: number): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as { command?: unknown; timeout_ms?: unknown };
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return toolError("run_command: не указан command", startedAt, true);
  if (process.platform === "win32") {
    return toolError("run_command: поддерживается на macOS и Linux", startedAt, true);
  }
  const verdict = guardVerdict(ctx.repoRoot, command);
  if (!verdict.allowed) {
    return toolError(`run_command: команда отклонена guard-политикой.\n${capToolOutput(verdict.reason)}`, startedAt, true);
  }
  const timeoutMs = Math.min(
    Number.isInteger(args.timeout_ms) && (args.timeout_ms as number) > 0 ? (args.timeout_ms as number) : COMMAND_TIMEOUT_MS,
    COMMAND_TIMEOUT_MAX_MS,
  );
  return await new Promise<ToolResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("/bin/bash", ["-s"], { cwd: ctx.cwd, env: process.env });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    const finish = (result: Omit<ToolResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_TOOL_OUTPUT * 4) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_TOOL_OUTPUT * 4) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish({ ok: false, output: `run_command: запуск не выполнен: ${error.message}`, blocked: false });
    });
    child.on("close", (code) => {
      let output = stdout;
      if (stderr.trim()) output += (output ? "\n" : "") + "[stderr]\n" + stderr;
      if (code !== 0) output += `${output ? "\n" : ""}[код выхода: ${code ?? "сигнал"}]`;
      finish({ ok: code === 0, output: capToolOutput(output || "(вывода нет)"), blocked: false });
    });
    child.stdin.end(command + "\n");
  });
}

/* ------------------------------------ диспетчер ----------------------------------- */

/** Исполнить вызов инструмента по имени; неизвестное имя - ошибочный результат. */
export async function executeTool(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> {
  const startedAt = Date.now();
  if (name === "read_file") return toolReadFile(ctx, args, startedAt);
  if (name === "list_dir") return toolListDir(ctx, args, startedAt);
  if (name === "run_command") return toolRunCommand(ctx, args, startedAt);
  return toolError(`неизвестный инструмент: ${name}`, startedAt, true);
}

/* ------------------------- провайдер-кандидат runtime-схемы ------------------------- */

export interface ProviderCandidate {
  runtimeId: string;
  providerId: string;
  preset: ProviderPreset;
  entry: ProviderEntry;
}

/**
 * Разрешить провайдер-кандидата шага ("provider:<id>"): пресет существует,
 * запись активна. ok: false без error - значение не является провайдер-кандидатом;
 * ok: false с error - текст для события step.runtime-unavailable.
 */
export async function resolveProviderCandidate(
  repoRoot: string,
  runtimeId: string,
  state: ConsoleState,
): Promise<{ ok: true; candidate: ProviderCandidate } | { ok: false; error?: string }> {
  const providerId = parseTaskProviderId(runtimeId);
  if (!providerId) return { ok: false };
  const preset = providerPresetById(providerId);
  if (!preset) return { ok: false, error: `провайдер не найден в реестре: ${providerId}` };
  const entry = await readProviderEntry(repoRoot, preset, state.providers?.entries?.[providerId] ?? null);
  if (!isActiveProvider(preset, entry)) {
    return { ok: false, error: `провайдер ${preset.label} не активен - пройдите проверку на вкладке "Провайдеры"` };
  }
  return { ok: true, candidate: { runtimeId, providerId, preset, entry } };
}

/** Включённые MCP-серверы для набора имён (роли шага или весь реестр). */
export function enabledMcpServers(state: ConsoleState, names?: string[]): McpServerDef[] {
  const all = Object.values(state.mcp?.servers ?? {});
  if (!names?.length) return all.filter((server) => server.enabled);
  const wanted = new Set(names);
  return all.filter((server) => wanted.has(server.name) && server.enabled);
}
