import { spawn } from "node:child_process";
import path from "node:path";
import { runAgentLoop } from "@/core/agentLoop";
import { enabledMcpServers, resolveProviderCandidate } from "@/core/agentTools";
import { launchPromptRun } from "@/core/prompts";
import { callMcpTool, listMcpTools } from "@/core/mcp/client";
import { finishTaskMeta, newTaskId, saveTaskMeta, taskTitle } from "@/core/tasks";
import type { ConsoleState } from "@/core/state";
import type { RuntimeAdapter } from "@/core/types";
import { DESIGN_MCP_NAMES } from "./sync";
import { loadDesignPack, tokensSummary } from "./workspace";

/**
 * Единый запуск дизайн-задач: одна точка входа для headless-рантайма
 * (claude/opencode - новая сессия с cwd = рабочая папка), провайдера из
 * реестра (агентный цикл в процессе консоли, MCP open-design/figma в
 * инструментах) и отдельно запущенной сессии (headless-resume CLI).
 * Результат уходит в лог .agents/console/runs/ и реестр задач.
 */

export type DesignRunTarget =
  | { kind: "runtime"; id: string }
  | { kind: "provider"; id: string }
  | { kind: "session"; runtime: string; sessionId: string };

export type DesignRunResult =
  | { kind: "runtime"; ok: boolean; runtime: string; logFile: string; pid: number | null; detail: string }
  | { kind: "provider"; ok: boolean; text: string; logFile: string; error?: string; usage: import("@/core/agentLoop").AgentLoopUsage | null }
  | { kind: "session"; ok: boolean; runtime: string; sessionId: string; output: string; error?: string; durationMs: number };

/** Разбор цели из тела запроса; неизвестная форма - текст ошибки. */
export function parseDesignRunTarget(input: unknown): DesignRunTarget | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "нужен target" };
  const raw = input as { kind?: unknown; id?: unknown; runtime?: unknown; sessionId?: unknown };
  if (raw.kind === "runtime" && typeof raw.id === "string" && raw.id.trim()) return { kind: "runtime", id: raw.id.trim() };
  if (raw.kind === "provider" && typeof raw.id === "string" && raw.id.trim()) return { kind: "provider", id: raw.id.trim() };
  if (raw.kind === "session" && typeof raw.runtime === "string" && typeof raw.sessionId === "string" && raw.runtime.trim() && raw.sessionId.trim()) {
    return { kind: "session", runtime: raw.runtime.trim(), sessionId: raw.sessionId.trim() };
  }
  return { error: "target: {kind:\"runtime\", id} | {kind:\"provider\", id} | {kind:\"session\", runtime, sessionId}" };
}

/**
 * Design router: исполнитель по умолчанию и дизайн-MCP из настройки
 * settings.workflows.designProviders (порядок провайдеров дизайна рантайма).
 * "claude-design" означает встроенную команду /design рантайма claude;
 * open-design и figma - имена серверов в реестре MCP.
 */
export function resolveDesignRouter(state: ConsoleState): { executor: string; designMcp: string[] } {
  const executor = state.defaultRuntime ?? "claude";
  const order = state.settings.workflows.designProviders[executor] ?? DESIGN_MCP_NAMES;
  const designMcp = order.filter((name) => DESIGN_MCP_NAMES.includes(name) && state.mcp.servers[name]?.enabled);
  return { executor, designMcp };
}

function promptPreamble(pack: Awaited<ReturnType<typeof loadDesignPack>>): string {
  const lines = [
    "Дизайн-контекст проекта (рабочая папка - текущая):",
    "- DESIGN.md - визуальные токены (формат @google/design.md); прочитай файл перед началом.",
    "- BRAND.md - бренд-паспорт (имя, аудитория, тон, фирменные элементы); следуй ему в смысловых вопросах.",
    "- design/ui-kit.md - правила интерфейса web и mobile.",
    "- design/components.json - реестр компонентов проекта; новые компоненты добавляй в него.",
  ];
  if (pack.design.tokens) lines.push(`Ключевые токены: ${tokensSummary(pack.design.tokens)}.`);
  return lines.join("\n");
}

function providerSystemPrompt(pack: Awaited<ReturnType<typeof loadDesignPack>>): string {
  const sections = [
    "Ты выполняешь дизайн-задачу Harness в рабочей папке проекта.",
    "Следуй дизайн-контексту: токены DESIGN.md обязательны, хардкод цветов и радиусов не применяется.",
    "",
    `Ключевые токены DESIGN.md: ${pack.design.tokens ? tokensSummary(pack.design.tokens) : "файл DESIGN.md отсутствует в рабочей папке"}.`,
  ];
  if (pack.uikit.exists) {
    sections.push("", "## Правила интерфейса (design/ui-kit.md)", pack.uikit.content.slice(0, 8_000));
  }
  if (pack.brand.exists) {
    sections.push("", "## Бренд (BRAND.md)", pack.brand.content.slice(0, 6_000));
  }
  if (pack.components.exists && pack.components.manifest) {
    const manifest = pack.components.manifest;
    const count = manifest.web.length + manifest.mobile.length;
    if (count > 0) {
      sections.push(
        "",
        `## Компоненты проекта (${count})`,
        JSON.stringify({ web: manifest.web.slice(0, 50), mobile: manifest.mobile.slice(0, 50) }, null, 2).slice(0, 4_000),
      );
    }
  }
  return sections.join("\n");
}

const PROVIDER_TIMEOUT_MS = 600_000;
const SESSION_TIMEOUT_MS = 300_000;
const SESSION_OUTPUT_CAP = 256_000;

async function runSessionTarget(opts: {
  adapter: RuntimeAdapter;
  runtime: string;
  sessionId: string;
  prompt: string;
  cwd: string;
}): Promise<DesignRunResult> {
  const cmd = opts.adapter.replyCommand?.(opts.sessionId, opts.prompt);
  if (!cmd) {
    return { kind: "session", ok: false, runtime: opts.runtime, sessionId: opts.sessionId, output: "", error: "рантайм не поддерживает headless-ответ в сессию", durationMs: 0 };
  }
  const startedAt = Date.now();
  const result = await new Promise<{ code: number | null; output: string; error?: string }>((resolve) => {
    let output = "";
    let error = "";
    const child = spawn(cmd.command, cmd.args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, output, error: `превышен таймаут ${SESSION_TIMEOUT_MS / 1000} с` });
    }, SESSION_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < SESSION_OUTPUT_CAP) output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (error.length < 64_000) error += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output, error: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, error: error.trim() || undefined });
    });
  });
  return {
    kind: "session",
    ok: result.code === 0,
    runtime: opts.runtime,
    sessionId: opts.sessionId,
    output: result.output.slice(-8_000),
    error: result.error,
    durationMs: Date.now() - startedAt,
  };
}

/** Исполнить дизайн-задачу выбранной целью. dir - проверенная рабочая папка. */
export async function runDesignTask(opts: {
  repoRoot: string;
  state: ConsoleState;
  dir: string;
  prompt: string;
  target: DesignRunTarget;
  adapters: Record<string, RuntimeAdapter>;
}): Promise<DesignRunResult> {
  const { repoRoot, state, dir, prompt } = opts;
  const pack = await loadDesignPack(dir);

  if (opts.target.kind === "runtime") {
    const adapter = opts.adapters[opts.target.id];
    if (!adapter?.runCommand) {
      return { kind: "runtime", ok: false, runtime: opts.target.id, logFile: "", pid: null, detail: `рантайм ${opts.target.id} не поддерживает headless-запуск` };
    }
    const text = `${promptPreamble(pack)}\n\n## Задача\n\n${prompt.trim()}\n\nСоблюдай AGENTS.md и политику репозитория (guardrails/src/cli.ts).`;
    const launched = await launchPromptRun({ repoRoot, adapter, runtimeId: opts.target.id, prompt: text, cwd: dir });
    return { kind: "runtime", ok: launched.ok, runtime: launched.runtime, logFile: launched.logFile, pid: launched.pid, detail: launched.detail };
  }

  if (opts.target.kind === "provider") {
    const resolved = await resolveProviderCandidate(repoRoot, opts.target.id, state);
    if (!resolved.ok) {
      return { kind: "provider", ok: false, text: "", logFile: "", error: resolved.error ?? `провайдер ${opts.target.id} не активен`, usage: null };
    }
    const model = resolved.candidate.entry.models.standard?.trim();
    if (!model) {
      return { kind: "provider", ok: false, text: "", logFile: "", error: `у провайдера ${resolved.candidate.preset.label} не задана модель tier standard`, usage: null };
    }
    const servers = enabledMcpServers(state, DESIGN_MCP_NAMES);
    const listed = servers.length ? await listMcpTools({ cwd: dir, servers }) : [];
    const mcpTools = listed.flatMap((group) =>
      group.tools.map((tool) => ({ name: tool.qualifiedName, description: tool.description, parameters: tool.parameters })),
    );
    const logFile = path.join(repoRoot, ".agents", "console", "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-design-${resolved.candidate.providerId}.log`);
    const taskId = await saveTaskMeta(repoRoot, {
      kind: "prompt",
      title: taskTitle(`Дизайн-задача: ${prompt}`),
      executor: { type: "provider", id: resolved.candidate.providerId },
      model,
      pid: null,
      sessionRuntime: null,
      logFile,
      detail: dir,
    }).catch(() => null);
    const result = await runAgentLoop({
      repoRoot,
      providerId: resolved.candidate.providerId,
      preset: resolved.candidate.preset,
      entry: resolved.candidate.entry,
      model,
      system: providerSystemPrompt(pack),
      prompt: prompt.trim(),
      toolCwd: dir,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      mcpTools,
      callMcp: servers.length ? (qualifiedName, args) => callMcpTool({ cwd: dir, servers, qualifiedName, args }) : undefined,
      logFile,
    });
    if (taskId) await finishTaskMeta(repoRoot, taskId, result.ok ? "completed" : "failed").catch(() => undefined);
    return { kind: "provider", ok: result.ok, text: result.text, logFile, error: result.error, usage: result.ok ? result.usage : null };
  }

  const adapter = opts.adapters[opts.target.runtime];
  if (!adapter) {
    return { kind: "session", ok: false, runtime: opts.target.runtime, sessionId: opts.target.sessionId, output: "", error: `неизвестный рантайм: ${opts.target.runtime}`, durationMs: 0 };
  }
  return runSessionTarget({ adapter, runtime: opts.target.runtime, sessionId: opts.target.sessionId, prompt: prompt.trim(), cwd: dir });
}

/** Реестр задач: экспорт id-генератора не нужен роутам, оставлен для симметрии. */
export const designTaskId = newTaskId;
