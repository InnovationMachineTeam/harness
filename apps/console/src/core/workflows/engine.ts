import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Annotation, Command, END, START, StateGraph, interrupt, isGraphBubbleUp } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ADAPTERS } from "../../runtimes";
import { processAlive } from "../memory";
import { launchPromptRun, runtimeModelForTier, type EffortLevel } from "../prompts";
import { runAgentLoop, loopReceiptId, type LoopTool } from "../agentLoop";
import { enabledMcpServers, resolveProviderCandidate } from "../agentTools";
import { callMcpTool, listMcpTools } from "../mcp/client";
import { loadConsoleState, isMandatoryWorkspace } from "../state";
import { parseTaskProviderId, providerBaseUrlError, providerPresetById, type ModelTier } from "../providers";
import { loadInternalSkills, loadRoles } from "./catalog";
import { syncTaskToAgentPlane } from "./agentplane";
import { renderSkillBlock, renderSkillsSection, untrustedNotice } from "./skills";
import { listRoadmapItems, saveRoadmapItem, findingFingerprint } from "./roadmap";
import { parseTaskList, runSprintNode } from "./sprint";
import type { WorkflowStep } from "./schema";
import { WorkflowStore, type WorkflowDb, type WorkflowRunRecord } from "./storage";

const locks = new Map<string, Promise<void>>();

const GraphState = Annotation.Root({
  runId: Annotation<string>(),
  input: Annotation<Record<string, unknown>>(),
  artifacts: Annotation<Record<string, string>>({
    reducer: (current, update) => ({ ...(current ?? {}), ...(update ?? {}) }),
    default: () => ({}),
  }),
  completed: Annotation<string[]>({
    reducer: (current, update) => [...new Set([...(current ?? []), ...(update ?? [])])],
    default: () => [],
  }),
});

type GraphStateValue = typeof GraphState.State;

/** Роль, развёрнутая в инструкции для промпта: замороженная или живая. */
interface ResolvedRole {
  id: string;
  title: string;
  text: string;
  skills: string[];
  mcp: string[];
  tools: string[];
  defaultTier?: "fast" | "standard" | "strong" | "subagents";
  defaultEffort?: EffortLevel;
  unavailable: Array<{ kind: "skill" | "mcp" | "tool"; id: string; reason: string }>;
}

/** Результат проверки одного критерия чеклиста (DoR, DoD, AC). */
interface CriterionResult {
  criterion: string;
  status: "pass" | "fail";
  note: string;
}

interface SectionVerdict {
  verdict: "pass" | "fail";
  category: "tests" | "review";
  findings: string[];
  comments: string;
  criteria: CriterionResult[];
}

interface AgentResult {
  output: string;
  usage: { inputTokens: number; outputTokens: number; cacheTokens: number; receiptId: string; raw: unknown } | null;
  runtime: string;
}

async function withWorkspaceLock<T>(workspaceDir: string, mode: WorkflowStep["resources"]["workspace"], fn: () => Promise<T>): Promise<T> {
  if (mode !== "write") return fn();
  const previous = locks.get(workspaceDir) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(workspaceDir, queued);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(workspaceDir) === queued) locks.delete(workspaceDir);
  }
}

async function waitForProcess(pid: number | null, timeoutMs: number): Promise<void> {
  if (pid === null) return;
  const started = Date.now();
  while (processAlive(pid)) {
    if (Date.now() - started > timeoutMs) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Процесс уже завершился.
      }
      throw new Error("timeout шага: " + timeoutMs + " ms");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function pricedUsage(repoRoot: string, runtime: string | undefined, model: string | undefined, usage: { inputTokens: number; outputTokens: number; cacheTokens: number }): Promise<{ inputTokens: number; outputTokens: number; cacheTokens: number; costValue?: number; costCurrency?: string; pricingCoverage: number }> {
  if (!runtime || !model) return { ...usage, pricingCoverage: 0 };
  try {
    const config = JSON.parse(await readFile(`${repoRoot}/.agents/runtime/${runtime}/config.json`, "utf8")) as { pricingVerified?: boolean; models?: Record<string, { model?: string; pricing?: { inputUsdMtok?: number; outputUsdMtok?: number; cacheUsdMtok?: number } }> };
    if (!config.pricingVerified) return { ...usage, pricingCoverage: 0 };
    const card = Object.values(config.models ?? {}).find((entry) => entry.model === model)?.pricing;
    if (!card?.inputUsdMtok || !card.outputUsdMtok) return { ...usage, pricingCoverage: 0 };
    const costValue = usage.inputTokens * card.inputUsdMtok / 1_000_000 + usage.outputTokens * card.outputUsdMtok / 1_000_000 + usage.cacheTokens * (card.cacheUsdMtok ?? 0) / 1_000_000;
    return { ...usage, costValue, costCurrency: "USD", pricingCoverage: 1 };
  } catch { return { ...usage, pricingCoverage: 0 }; }
}

/** Результаты по критериям чеклиста из вердикта; вердикт без criteria даёт пустой список. */
function parseCriteria(value: unknown): CriterionResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && String((item as Record<string, unknown>).criterion ?? (item as Record<string, unknown>).name ?? "").trim()))
    .map((item) => ({
      criterion: String(item.criterion ?? item.name ?? "").trim(),
      status: item.status === "fail" ? "fail" : "pass",
      note: String(item.note ?? item.comment ?? ""),
    }));
}

/** Сбалансированный JSON-объект вокруг вхождения "verdict": скобки считаются с учётом строк и экранирования. */
function balancedJsonObjectAt(text: string, from: number): string | null {
  const start = text.lastIndexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Машиночитаемый вердикт контроля: ```json-блок, любой ```-блок или JSON-объект с "verdict" в тексте (включая вложенные criteria). */
export function parseVerdict(output: string): SectionVerdict {
  const candidates: string[] = [];
  for (const fence of output.match(/```(?:json)?\s*([\s\S]*?)```/g) ?? []) {
    candidates.push(fence.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, ""));
  }
  for (const match of output.matchAll(/"verdict"/g)) {
    const candidate = balancedJsonObjectAt(output, match.index ?? 0);
    if (candidate) candidates.push(candidate);
  }
  for (const candidate of candidates.reverse()) {
    try {
      const raw = JSON.parse(candidate) as Record<string, unknown>;
      if (raw && (raw.verdict === "pass" || raw.verdict === "fail")) {
        return {
          verdict: raw.verdict,
          category: raw.category === "tests" ? "tests" : "review",
          findings: Array.isArray(raw.findings) ? raw.findings.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : [],
          comments: String(raw.comments ?? ""),
          criteria: parseCriteria(raw.criteria),
        };
      }
    } catch { /* не блок вердикта */ }
  }
  throw new Error('контроль не вернул машинный вердикт (```json {"verdict": ...}```)');
}

/** Список AC из ```json-блока: {"ac":[...]} или массив строк; без валидного блока - пустой список. */
export function parseAcList(output: string): string[] {
  const blocks = output.match(/```json\s*([\s\S]*?)```/g) ?? [];
  for (const block of [...blocks].reverse()) {
    try {
      const raw = JSON.parse(block.replace(/^```json\s*/, "").replace(/```\s*$/, "")) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).ac) ? (raw as Record<string, unknown>).ac as unknown[] : null;
      if (list) {
        const items = list.map((item) => String(item ?? "").trim()).filter(Boolean);
        if (items.length) return items;
      }
    } catch { /* не блок AC */ }
  }
  return [];
}

/** Варианты входа из ```json-блока: {"variants":[{"label","text"}]} или массив строк. */
export function parseInputVariants(output: string): Array<{ label: string; text: string }> {
  return parseInputConfirmation(output).variants;
}

/** Подтверждение входа из ```json-блока: варианты формулировки и уточняющие вопросы контролёра. */
export function parseInputConfirmation(output: string): { variants: Array<{ label: string; text: string }>; questions: string[] } {
  const blocks = output.match(/```json\s*([\s\S]*?)```/g) ?? [];
  for (const block of [...blocks].reverse()) {
    try {
      const raw = JSON.parse(block.replace(/^```json\s*/, "").replace(/```\s*$/, "")) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).variants) ? (raw as Record<string, unknown>).variants as unknown[] : null;
      if (!list) continue;
      const variants = list
        .map((item) => typeof item === "string" ? { label: "вариант", text: item.trim() } : item && typeof item === "object" && String((item as Record<string, unknown>).text ?? "").trim() ? { label: String((item as Record<string, unknown>).label ?? "вариант"), text: String((item as Record<string, unknown>).text).trim() } : null)
        .filter((item): item is { label: string; text: string } => Boolean(item && item.text))
        .slice(0, 4);
      const rawQuestions = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).questions) ? (raw as Record<string, unknown>).questions as unknown[] : [];
      const questions = rawQuestions.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 4);
      if (variants.length || questions.length) return { variants, questions };
    } catch { /* не варианты */ }
  }
  return { variants: [], questions: [] };
}

/**
 * Конверт результата headless-вызова (`--output-format json`): последняя строка
 * лога вида {"type":"result",...,"result":"<текст>","usage":{...}}. Строки
 * предупреждений рантайма в том же логе пропускаются; конверт без текста и
 * usage (ошибка исполнения) не считается результатом.
 */
export function parseJsonEnvelope(log: string): { result: string; usage: Record<string, unknown>; costUsd?: number; id?: string } | null {
  for (const line of log.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      if (raw.type !== "result" && !("result" in raw)) continue;
      const usage = (raw.usage && typeof raw.usage === "object" ? raw.usage : {}) as Record<string, unknown>;
      const result = String(raw.result ?? "");
      if (!result && !Object.keys(usage).length) continue;
      const cost = Number(raw.total_cost_usd);
      return {
        result,
        usage,
        costUsd: Number.isFinite(cost) ? cost : undefined,
        id: raw.session_id != null ? String(raw.session_id) : undefined,
      };
    } catch { /* не конверт */ }
  }
  return null;
}

/**
 * Конверт результата codex (`exec --json`): JSONL-события; текст ответа -
 * последний item.completed/agent_message, usage - из последнего turn.completed.
 * Строки диагностики (stderr rmcp и баннер) пропускаются; без agent_message
 * конверт не считается результатом.
 */
export function parseCodexStream(log: string): { result: string; usage: Record<string, unknown>; id?: string } | null {
  let result: string | null = null;
  let usage: Record<string, unknown> = {};
  let id: string | undefined;
  for (const line of log.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch { continue; }
    if (event.type === "item.completed" && (event.item as Record<string, unknown> | undefined)?.type === "agent_message") {
      const text = String((event.item as Record<string, unknown>).text ?? "");
      if (text.trim()) result = text;
      continue;
    }
    if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") {
      const raw = event.usage as Record<string, unknown>;
      usage = {
        input_tokens: Number(raw.input_tokens ?? 0),
        output_tokens: Number(raw.output_tokens ?? 0),
        // cached_input_tokens codex = кеш-чтение в терминах claude-конверта.
        cache_read_input_tokens: Number(raw.cached_input_tokens ?? 0),
      };
      continue;
    }
    if (event.type === "session.created" && (event.session as Record<string, unknown> | undefined)?.id) {
      id = String((event.session as Record<string, unknown>).id);
    }
  }
  if (result === null) return null;
  return { result, usage, id };
}

/** Конверт вызова рантайма в workflow: claude - result-конверт, codex - JSONL-стрим, остальные - plain text. */
function parseRunEnvelope(runtimeId: string, log: string): { result: string; usage: Record<string, unknown>; costUsd?: number; id?: string } | null {
  if (runtimeId === "codex") return parseCodexStream(log);
  if (log.trim().startsWith("{") || log.includes("\n{")) return parseJsonEnvelope(log);
  return null;
}

export async function resolveRoles(repoRoot: string, run: WorkflowRunRecord, ids: string[], stepId?: string): Promise<ResolvedRole[]> {
  if (!ids.length) return [];
  const catalog = await loadRoles(repoRoot);
  return ids.map((id) => {
    const frozen = run.snapshot.resolution?.roles[id];
    const live = catalog.find((role) => role.value.id === id);
    const text = frozen?.content ?? live?.body ?? null;
    if (!text || !text.trim()) throw new Error("роль не найдена или пуста: " + id);
    const unavailable = (run.snapshot.resolution?.unavailableCapabilities ?? [])
      .filter((item) => item.roleId === id && (!stepId || item.stepId === stepId))
      .map((item) => ({ kind: item.kind, id: item.id, reason: item.reason }));
    return {
      id, title: frozen?.title ?? live?.value.title ?? id, text,
      skills: frozen?.skills ?? live?.value.skills ?? [],
      mcp: frozen?.mcp ?? live?.value.mcp ?? [],
      tools: frozen?.tools ?? live?.value.tools ?? [],
      defaultTier: frozen?.defaultTier ?? live?.value.defaultTier,
      defaultEffort: frozen?.defaultEffort ?? live?.value.defaultEffort,
      unavailable,
    };
  });
}

function rolesPromptSection(roles: ResolvedRole[]): string {
  return roles.map((role) => [
    "### Роль: " + role.id + " - " + role.title,
    role.skills.length || role.mcp.length || role.tools.length ? "Capabilities: skills=" + (role.skills.join(", ") || "нет") + "; MCP=" + (role.mcp.join(", ") || "нет") + "; tools=" + (role.tools.join(", ") || "нет") : "",
    role.unavailable.length ? "Недоступные capabilities: " + role.unavailable.map((item) => `${item.kind}:${item.id}`).join(", ") + ". Используй fallback роли, не утверждай, что capability была вызвана, и запиши ограничение в результат." : "",
    role.text.trim(),
  ].filter(Boolean).join("\n")).join("\n\n");
}

function sectionPrompt(opts: {
  section: string;
  node: WorkflowStep;
  run: WorkflowRunRecord;
  state: GraphStateValue;
  roles: ResolvedRole[];
  assignment: string;
  skills: string[];
  verdictRequired: boolean;
}): string {
  const context = Object.entries(opts.state.artifacts)
    .map(([name, content]) => "## " + name + "\n" + content)
    .join("\n\n")
    .slice(-24000);
  const roles = rolesPromptSection(opts.roles);
  return [
    "Ты выполняешь секцию \"" + opts.section + "\" шага workflow Harness.",
    "Run: " + opts.run.id,
    "Workflow: " + opts.run.workflowId,
    "Step: " + opts.node.id + " - " + opts.node.title,
    "Phase: " + opts.node.phase,
    opts.node.description ? "Описание шага: " + opts.node.description : "",
    roles ? "## Роли\n" + roles : "",
    opts.assignment ? "## Задание секции\n" + opts.assignment : "",
    opts.skills.length ? "## Master skills\n" + opts.skills.join("\n\n") : "",
    context ? "## Доступные артефакты\n" + context : "",
    "## Вход пользователя",
    JSON.stringify(opts.run.input, null, 2),
    "",
    opts.verdictRequired
      ? 'Ответ заверши строго одним блоком ```json {"verdict":"pass|fail","category":"tests|review","criteria":[{"criterion":"текст критерия из задания дословно","status":"pass|fail","note":"пояснение"}],"findings":["..."],"comments":"..."} - это последний блок ответа, после него никакого текста. В criteria верни результат по каждому критерию из задания. Без этого блока ответ считается технически невалидным.'
      : "Верни завершённый Markdown-артефакт этой секции. Укажи факты, предположения, открытые вопросы и проверки.",
  ].filter(Boolean).join("\n");
}

async function collectSkills(repoRoot: string, run: WorkflowRunRecord, roles: ResolvedRole[]): Promise<Array<{ id: string; content: string }>> {
  const unavailable = new Set(roles.flatMap((role) => role.unavailable).filter((item) => item.kind === "skill").map((item) => item.id));
  // Run-уровневые навыки (/master: из запроса запуска) + навыки ролей узла.
  const runSkillIds = Array.isArray(run.input.masterSkills)
    ? run.input.masterSkills.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const ids = [...new Set([...runSkillIds, ...roles.flatMap((role) => role.skills)])].filter((id) => id && !unavailable.has(id));
  if (!ids.length) return [];
  const catalog = await loadInternalSkills(repoRoot);
  const out: Array<{ id: string; content: string }> = [];
  for (const id of ids) {
    const frozen = run.snapshot.resolution?.skills[id];
    if (frozen) { out.push({ id, content: frozen.content }); continue; }
    const live = catalog.find((item) => item.value.id === id);
    if (!live) throw new Error("master-навык недоступен: " + id);
    out.push({ id, content: live.content });
  }
  return out;
}

/* --------------------- файлы задачи (.agents/console/tasks) --------------------- */

/** Вся поставка прогонов консоли живёт под .agents/console - как SQLite и логи. */
function taskRoot(repoRoot: string, run: WorkflowRunRecord): string {
  return path.join(repoRoot, ".agents", "console", "tasks", run.id);
}

/** Путь внутри папки задачи с проверкой границы: сегменты обязаны оставаться внутри корня задачи. */
function safeTaskPath(repoRoot: string, run: WorkflowRunRecord, segments: string[]): string {
  const root = taskRoot(repoRoot, run);
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(root + path.sep)) throw new Error("недопустимый путь файла задачи: " + segments.join("/"));
  return target;
}

function safeSegment(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value) || value.includes("..")) throw new Error("недопустимое имя файла задачи: " + value);
  return value;
}

async function writeTaskFile(repoRoot: string, run: WorkflowRunRecord, segments: string[], content: string): Promise<string> {
  const file = safeTaskPath(repoRoot, run, segments.map(safeSegment));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content.endsWith("\n") ? content : content + "\n", "utf8");
  return path.relative(repoRoot, file);
}

function reworkAssignment(kind: string, findings: string[], comments: string, criteria: CriterionResult[] = []): string {
  const failed = criteria.filter((item) => item.status === "fail");
  return [
    "# Задание на доработку (" + kind + ")",
    "",
    "## Что не учтено",
    ...(findings.length ? findings.map((item) => "- " + item) : ["- вердикт контроля: fail"]),
    "",
    "## Проваленные критерии",
    ...(failed.length ? failed.map((item) => "- " + item.criterion + (item.note ? " - " + item.note : "")) : ["- критерии не детализированы контролём"]),
    "",
    "## На что обратить внимание",
    comments || "Пояснения контроля отсутствуют; сверься с критериями секции.",
  ].join("\n");
}

/* ------------------------------ вызов агента ------------------------------ */

/** Кандидаты runtime шага: явный список или наследование defaults.runtime workflow. */
function effectiveCandidates(node: WorkflowStep, run: WorkflowRunRecord): string[] {
  const own = node.runtime.candidates;
  if (own.length) return own;
  return run.snapshot.defaults.runtime?.candidates ?? [];
}

/** Вызов агента с failover: попытка = полный проход по списку кандидатов в порядке схемы. */
export async function runAgentCall(opts: {
  repoRoot: string;
  store: WorkflowStore;
  run: WorkflowRunRecord;
  node: WorkflowStep;
  state: GraphStateValue;
  section: string;
  roles: ResolvedRole[];
  assignment: string;
  verdictRequired: boolean;
  lockWorkspace: boolean;
}): Promise<AgentResult> {
  const candidates = effectiveCandidates(opts.node, opts.run);
  if (!candidates.length) {
    return { output: "# " + opts.node.title + "\n\nСекция " + opts.section + ": список runtime пуст, вызов пропущен.\n", usage: null, runtime: "none" };
  }
  const tier = opts.node.runtime.tier ?? opts.roles.find((role) => role.defaultTier)?.defaultTier ?? "standard";
  const skills = await collectSkills(opts.repoRoot, opts.run, opts.roles);
  const unavailableMcp = new Set(opts.roles.flatMap((role) => role.unavailable).filter((item) => item.kind === "mcp").map((item) => item.id));
  const agentId = (opts.roles[0]?.id ?? "agent") + ":" + opts.node.id + ":" + opts.section;
  const execute = async (runtimeId: string): Promise<AgentResult> => {
    if (parseTaskProviderId(runtimeId)) return executeProvider(runtimeId);
    const adapter = ADAPTERS[runtimeId];
    if (!adapter) throw new Error("runtime adapter не найден: " + runtimeId);
    const frozenModel = opts.run.snapshot.resolution?.runtimes[runtimeId]?.models[tier];
    const model = frozenModel ?? await runtimeModelForTier(opts.repoRoot, runtimeId, tier);
    const attemptId = opts.store.beginAttempt(opts.run.id, opts.node.id, {
      runtime: runtimeId,
      model: model?.model,
      roles: opts.roles.map((role) => role.id),
      section: opts.section,
      skills: skills.map((skill) => skill.id),
      mcp: opts.roles.flatMap((role) => role.mcp).filter((id) => !unavailableMcp.has(id)),
    });
    const prompt = sectionPrompt({
      section: opts.section, node: opts.node, run: opts.run, state: opts.state,
      roles: opts.roles, assignment: opts.assignment, skills: skills.map((skill) => skill.content),
      verdictRequired: opts.verdictRequired,
    });
    // Промт секции в ledger: privacy прогона решает, хранится текст (full), размер с хешем (metadata) или ничего (aggregates).
    opts.store.appendEvent(opts.run.id, "step.prompt", {
      section: opts.section, runtime: runtimeId, model: model?.model ?? null, prompt,
    }, { stepId: opts.node.id, attemptId, agentId });
    opts.store.appendEvent(opts.run.id, "step.started", {
      section: opts.section, runtime: runtimeId, model: model?.model ?? null, roles: opts.roles.map((role) => role.id),
    }, { stepId: opts.node.id, attemptId, agentId });
    // Задача спринта исполняется в своём worktree; обычный шаг - в workspace прогона.
    const cwd = typeof opts.run.input.worktree === "string" && opts.run.input.worktree ? opts.run.input.worktree : opts.run.workspaceDir;
    // codex вызывается в режиме --json: движок извлекает из стрима текст и usage;
    // claude - в режиме --output-format json; остальные рантаймы - plain text.
    const machineOutput = adapter.headlessJson ? "json" as const : runtimeId === "codex" ? "stream" as const : null;
    const launched = await launchPromptRun({
      repoRoot: opts.repoRoot,
      adapter,
      runtimeId,
      prompt,
      cwd,
      model: model?.model,
      effort: opts.node.runtime.effort ?? opts.roles.find((role) => role.defaultEffort)?.defaultEffort ?? "medium",
      outputFormat: machineOutput === "json" ? "json" : undefined,
      jsonStream: machineOutput === "stream",
      correlation: { workflowRunId: opts.run.id, workflowStepId: opts.node.id, agentId },
    });
    if (!launched.ok) throw new Error(launched.detail);
    await waitForProcess(launched.pid, opts.node.timeoutMs);
    const output = await readFile(launched.logFile, "utf8").catch(() => "");
    // Рантаймы с машинным выводом обязаны вернуть конверт: plain-text ответ -
    // ошибка исполнения (например, "Failed to authenticate"), а не ответ агента;
    // бросаем для failover к следующему кандидату.
    const envelope = machineOutput ? parseRunEnvelope(runtimeId, output) : null;
    if (machineOutput && !envelope) {
      throw new Error("runtime завершился без машинного конверта результата: " + output.slice(0, 200).trim());
    }
    const body = envelope ? envelope.result : output;
    // Plain-text сообщения рантайма об ошибке (конфигурация, модель, аутентификация) -
    // не ответ агента: бросаем для failover к следующему кандидату.
    const firstLine = body.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
    if (/^(error|fatal|failed)\b/i.test(firstLine) || /^failed to authenticate/i.test(firstLine)) {
      throw new Error("runtime вернул сообщение об ошибке вместо артефакта: " + firstLine.slice(0, 200));
    }
    if (!body.trim()) throw new Error("runtime завершился без выходного артефакта");
    let usage: AgentResult["usage"] = null;
    if (envelope) {
      const inputTokens = Number(envelope.usage.input_tokens ?? envelope.usage.inputTokens ?? 0);
      const outputTokens = Number(envelope.usage.output_tokens ?? envelope.usage.outputTokens ?? 0);
      if (inputTokens || outputTokens) {
        usage = {
          inputTokens,
          outputTokens,
          cacheTokens: Number(envelope.usage.cache_read_input_tokens ?? envelope.usage.cache_tokens ?? 0),
          receiptId: envelope.id ?? createHash("sha256").update(output).digest("hex"),
          raw: envelope.usage,
        };
      }
    } else {
      for (const line of output.split("\n").reverse()) {
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          const value = (raw.usage && typeof raw.usage === "object" ? raw.usage : raw) as Record<string, unknown>;
          const inputTokens = Number(value.input_tokens ?? value.inputTokens ?? 0);
          const outputTokens = Number(value.output_tokens ?? value.outputTokens ?? 0);
          if (inputTokens || outputTokens) {
            usage = { inputTokens, outputTokens, cacheTokens: Number(value.cache_tokens ?? value.cached_tokens ?? value.cacheTokens ?? 0), receiptId: String(value.id ?? raw.id ?? createHash("sha256").update(line).digest("hex")), raw };
            break;
          }
        } catch { /* обычная строка runtime output */ }
      }
    }
    if (usage) {
      const priced = await pricedUsage(opts.repoRoot, runtimeId, model?.model, usage);
      // Конверт отдаёт фактическую стоимость вызова: используем её, если price card не подтверждён.
      const tracked = !priced.costValue && envelope?.costUsd != null
        ? { ...priced, costValue: envelope.costUsd, costCurrency: "USD", pricingCoverage: 1 }
        : priced;
      opts.store.finishAttempt(attemptId, "completed", null, tracked);
      opts.store.recordUsage({ runId: opts.run.id, stepId: opts.node.id, provider: runtimeId, runtime: runtimeId, model: model?.model, receiptId: usage.receiptId, raw: usage.raw, ...tracked });
    } else {
      opts.store.finishAttempt(attemptId, "completed", null);
    }
    return { output: body.slice(-1_000_000), usage, runtime: runtimeId };
  };
  // Провайдер-кандидат ("provider:<id>"): агентный цикл (function calling)
  // исполняется в процессе воркера - схема инструментов передаётся модели,
  // результаты вызовов возвращаются в контекст следующего запроса.
  const executeProvider = async (runtimeId: string): Promise<AgentResult> => {
    const state = await loadConsoleState(opts.repoRoot);
    const resolved = await resolveProviderCandidate(opts.repoRoot, runtimeId, state);
    if (!resolved.ok) throw new Error(resolved.error ?? "провайдер не активен: " + runtimeId);
    // Политика хоста: онлайн-провайдерам запрещены локальные и приватные адреса
    // (та же проверка, что в direct-чате; защите от SSRF подлежит и путь движка).
    const baseUrlError = providerBaseUrlError(resolved.candidate.entry.baseUrl, resolved.candidate.preset.kind);
    if (baseUrlError) throw new Error(baseUrlError);
    const frozenModel = opts.run.snapshot.resolution?.runtimes[runtimeId]?.models[tier];
    const model = frozenModel?.model ?? resolved.candidate.entry.models[tier as ModelTier]?.trim();
    if (!model) throw new Error("у провайдера не задана модель tier " + tier);
    const mcpNames = [...new Set(opts.roles.flatMap((role) => role.mcp).filter((id) => !unavailableMcp.has(id)))];
    const attemptId = opts.store.beginAttempt(opts.run.id, opts.node.id, {
      runtime: runtimeId,
      provider: resolved.candidate.providerId,
      model,
      roles: opts.roles.map((role) => role.id),
      section: opts.section,
      skills: skills.map((skill) => skill.id),
      mcp: mcpNames,
    });
    // Провайдер получает роли и master skills структурированно: SystemMessage
    // (роль + блоки навыков) + промт секции без этих разделов.
    const system = [
      "Ты выполняешь секцию workflow Harness. Роли и master skills секции переданы в этом сообщении.",
      skills.length || opts.roles.length ? untrustedNotice() : null,
      rolesPromptSection(opts.roles),
      renderSkillsSection(skills),
    ].filter(Boolean).join("\n\n");
    const prompt = sectionPrompt({
      section: opts.section, node: opts.node, run: opts.run, state: opts.state,
      roles: [], assignment: opts.assignment, skills: [],
      verdictRequired: opts.verdictRequired,
    });
    opts.store.appendEvent(opts.run.id, "step.prompt", {
      section: opts.section, runtime: runtimeId, model, prompt, system: system || null,
    }, { stepId: opts.node.id, attemptId, agentId });
    opts.store.appendEvent(opts.run.id, "step.started", {
      section: opts.section, runtime: runtimeId, model, roles: opts.roles.map((role) => role.id),
    }, { stepId: opts.node.id, attemptId, agentId });
    // Задача спринта исполняется в своём worktree; обычный шаг - в workspace прогона.
    const cwd = typeof opts.run.input.worktree === "string" && opts.run.input.worktree ? opts.run.input.worktree : opts.run.workspaceDir;
    // MCP-инструменты ролей шага: схемы передаются циклу, вызовы идут через клиент консоли.
    const mcpServers = enabledMcpServers(state, mcpNames);
    let mcpTools: LoopTool[] = [];
    if (mcpServers.length) {
      const listed = await listMcpTools({ cwd, servers: mcpServers });
      mcpTools = listed.flatMap((group) => group.tools.map((tool) => ({ name: tool.qualifiedName, description: tool.description, parameters: tool.parameters })));
      for (const group of listed) {
        if (group.error) opts.store.appendEvent(opts.run.id, "step.mcp-unavailable", { server: group.server, error: group.error }, { stepId: opts.node.id, attemptId, agentId });
      }
    }
    const result = await runAgentLoop({
      repoRoot: opts.repoRoot,
      providerId: resolved.candidate.providerId,
      preset: resolved.candidate.preset,
      entry: resolved.candidate.entry,
      model,
      system,
      prompt,
      toolCwd: cwd,
      timeoutMs: opts.node.timeoutMs,
      // Секции workflow объёмнее direct-чата: reasoning-моделям нужно больше раундов до финального ответа.
      maxRounds: 24,
      mcpTools,
      callMcp: mcpServers.length ? (qualifiedName, args) => callMcpTool({ cwd, servers: mcpServers, qualifiedName, args }) : undefined,
      onToolCall: (event) => {
        const payload: Record<string, unknown> = {
          tool: event.tool, args: event.args, status: event.ok ? "ok" : event.blocked ? "blocked" : "error",
          durationMs: event.durationMs, size: event.outputSize,
        };
        if (event.error) payload.error = event.error;
        opts.store.appendEvent(opts.run.id, "step.tool-call", payload, { stepId: opts.node.id, attemptId, agentId });
      },
      logFile: path.join(opts.repoRoot, ".agents", "console", "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-loop-${resolved.candidate.providerId}-${opts.node.id}.log`),
    });
    if (!result.ok) {
      opts.store.finishAttempt(attemptId, "failed", result.error ?? "агентный цикл не завершён");
      throw new Error(result.error ?? "агентный цикл не завершён");
    }
    if (!result.text.trim()) {
      opts.store.finishAttempt(attemptId, "failed", "провайдер завершился без выходного артефакта");
      throw new Error("провайдер завершился без выходного артефакта");
    }
    const usage: AgentResult["usage"] = {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheTokens: result.usage.cacheTokens,
      receiptId: loopReceiptId([opts.run.id, opts.node.id, opts.section, attemptId]),
      raw: { rounds: result.usage.rounds, toolCalls: result.usage.toolCalls },
    };
    const tracked = await pricedUsage(opts.repoRoot, runtimeId, model, usage);
    opts.store.finishAttempt(attemptId, "completed", null, tracked);
    opts.store.recordUsage({ runId: opts.run.id, stepId: opts.node.id, provider: resolved.candidate.providerId, runtime: runtimeId, model, receiptId: usage.receiptId, raw: usage.raw, ...tracked });
    return { output: result.text, usage, runtime: runtimeId };
  };
  // Прогон в дополнительной папке - режим только чтение: write-блокировка
  // узла honored только в обязательной рабочей папке (правило write/read mode).
  const state = await loadConsoleState(opts.repoRoot);
  const writeMode = opts.lockWorkspace && isMandatoryWorkspace(state, opts.run.workspaceDir);
  return withWorkspaceLock(opts.run.workspaceDir, writeMode ? opts.node.resources.workspace : "read", async () => {
    for (let attemptNo = 1; attemptNo <= opts.node.retry.maxAttempts; attemptNo += 1) {
      for (const runtimeId of candidates) {
        if (!ADAPTERS[runtimeId] && !providerPresetById(parseTaskProviderId(runtimeId) ?? "")) {
          opts.store.appendEvent(opts.run.id, "step.runtime-unavailable", { section: opts.section, runtime: runtimeId }, { stepId: opts.node.id });
          continue;
        }
        try {
          return await execute(runtimeId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          opts.store.appendEvent(opts.run.id, "step.runtime-failed", { section: opts.section, runtime: runtimeId, error: message, attempt: attemptNo }, { stepId: opts.node.id });
        }
      }
      opts.store.appendEvent(opts.run.id, "step.attempt-exhausted", { section: opts.section, attempt: attemptNo, maxAttempts: opts.node.retry.maxAttempts }, { stepId: opts.node.id });
    }
    throw new Error("рантаймы исчерпаны: [" + candidates.join(", ") + "] после " + opts.node.retry.maxAttempts + " попыток (секция " + opts.section + ")");
  });
}

/** Вызов с кешем по имени артефакта: исполняется один раз; реплей после interrupt берёт сохранённый результат. */
async function cachedCall(store: WorkflowStore, run: WorkflowRunRecord, node: WorkflowStep, name: string, exec: () => Promise<string>): Promise<string> {
  const existing = store.latestArtifact(run.id, node.id, name);
  if (existing && existing.content) return existing.content;
  const output = await exec();
  store.saveArtifact(run.id, node.id, name, output);
  return output;
}

/**
 * Варианты входа для ручной доработки первого шага (без поставщика): контролёр
 * готовит оператору 2-3 готовые формулировки входа, включая рекомендуемую.
 * Кеш - артефакт __variants-N; сбой генерации не блокирует возврат.
 */
async function generateInputConfirmation(
  repoRoot: string,
  store: WorkflowStore,
  run: WorkflowRunRecord,
  node: WorkflowStep,
  state: GraphStateValue,
  roles: ResolvedRole[],
  rework: string,
): Promise<{ variants: Array<{ label: string; text: string }>; questions: string[] }> {
  const returned = store.countArtifacts(run.id, node.id, "__ret-input-");
  const output = await cachedCall(store, run, node, "__variants-" + (returned + 1), () =>
    runAgentCall({
      repoRoot, store, run, node, state, section: "варианты входа", roles,
      assignment: [
        "Вход шага вернут на доработку. Подготовь оператору материалы для ручного подтверждения входа.",
        "variants: 2-3 варианта улучшенной формулировки входа. Каждый - готовый к отправке текст (3-6 предложений): проблема или возможность, целевая аудитория, ожидаемый результат. Первый - рекомендуемый; остальные - альтернативные прочтения задачи.",
        "questions: 2-4 уточняющих вопроса к оператору, ответы на которые устранят причину возврата; вопросы конкретные, каждый - одно предложение.",
        'Формат ответа: последний блок ```json {"variants":[{"label":"краткое название","text":"полный текст"}],"questions":["вопрос 1","вопрос 2"]}.',
        "",
        rework,
      ].filter(Boolean).join("\n\n"),
      verdictRequired: false, lockWorkspace: false,
    }).then((result) => result.output));
  return parseInputConfirmation(output);
}

/**
 * Генерация AC выходного контроля: основание - выходные артефакты шага,
 * требования исполнения, описание задачи и DoD. Кеш - артефакт __ac-N;
 * ответ без ```json списка считается неудачей (максимум 3 попытки).
 */async function generateAcceptanceCriteria(
  repoRoot: string,
  store: WorkflowStore,
  run: WorkflowRunRecord,
  node: WorkflowStep,
  state: GraphStateValue,
): Promise<string[]> {
  const control = node.outputControl;
  if (!control) return [];
  const roles = await resolveRoles(repoRoot, run, control.roles, node.id);
  for (let attemptNo = 1; attemptNo <= 3; attemptNo += 1) {
    const output = await cachedCall(store, run, node, "__ac-" + attemptNo, () =>
      runAgentCall({
        repoRoot, store, run, node, state, section: "критерии приёмки", roles,
        assignment: [
          "Сформулируй критерии приёмки (AC) шага workflow.",
          "Основание: выходные артефакты шага (" + (node.outputs.join(", ") || "выходы шага") + "), требования исполнения, описание задачи и DoD.",
          node.description ? "Описание задачи: " + node.description : "",
          node.execution.prompt ? "Требования исполнения: " + node.execution.prompt : "",
          control.dod.length ? "DoD:\n" + control.dod.map((item) => "- " + item).join("\n") : "",
          "Критерии проверяемы и измеримы; от 3 до 7 пунктов.",
          'Формат ответа: последний блок ```json {"ac":["..."]} - список строк.',
        ].filter(Boolean).join("\n\n"),
        verdictRequired: false, lockWorkspace: false,
      }).then((result) => result.output));
    const ac = parseAcList(output);
    if (ac.length) {
      store.appendEvent(run.id, "acceptance.criteria", { ac, source: "generated" }, { stepId: node.id });
      return ac;
    }
    store.saveArtifact(run.id, node.id, "__ac-parsefail-" + attemptNo, "список ac отсутствует");
  }
  store.appendEvent(run.id, "acceptance.criteria", { ac: [], source: "generated", reason: "генерация не вернула список после 3 попыток" }, { stepId: node.id });
  return [];
}

/* ------------------------------- конвейер шага ------------------------------- */

async function runStepPipeline(
  repoRoot: string,
  store: WorkflowStore,
  run: WorkflowRunRecord,
  node: WorkflowStep,
  supplier: WorkflowStep | null,
  state: GraphStateValue,
): Promise<Partial<GraphStateValue>> {
  /* -------- 1. Входной контроль: DoR, возврат поставщику, попытки -------- */
  if (node.inputControl && node.inputControl.roles.length) {
    const maxAttempts = node.inputControl.maxAttempts;
    const roles = await resolveRoles(repoRoot, run, node.inputControl.roles, node.id);
    let parseFeedback = "";
    let parseFails = 0;
    for (;;) {
      const cycle = store.countArtifacts(run.id, node.id, "__ic-");
      // Ключ кеша меняется с каждой попыткой без вердикта: повтор после паузы не получает закешированный плохой ответ.
      const cacheKey = "__ic-" + cycle + (parseFails ? "f" + parseFails : "");
      const assignment = [
        "Проверь вход шага по Definition of Ready.",
        node.inputControl.dor.length ? "DoR:\n" + node.inputControl.dor.map((item) => "- " + item).join("\n") : "",
        node.inputControl.prompt,
        node.inputs.length ? "Проверяемые артефакты: " + node.inputs.join(", ") : "",
        parseFeedback,
      ].filter(Boolean).join("\n\n");
      const output = await cachedCall(store, run, node, cacheKey, () =>
        runAgentCall({ repoRoot, store, run, node, state, section: "входной контроль", roles, assignment, verdictRequired: true, lockWorkspace: false }).then((result) => result.output));
      let verdict: SectionVerdict;
      try {
        verdict = parseVerdict(output);
      } catch {
        // Вердикта нет - контроль вызывается заново с фидбеком; после двух неудач - остановка.
        if (parseFails >= 2) throw new Error("входной контроль дважды не вернул машинный вердикт");
        parseFails += 1;
        store.saveArtifact(run.id, node.id, "__icfail-" + parseFails, "verdict отсутствует");
        parseFeedback = "Предыдущий ответ не содержал машинный вердикт - верни строго блок ```json с полями verdict, criteria, findings, comments. Начало предыдущего ответа: " + output.slice(0, 300).trim();
        continue;
      }
      store.appendEvent(run.id, "input.checked", { cycle: cycle + 1, verdict: verdict.verdict, criteria: verdict.criteria }, { stepId: node.id });
      if (verdict.verdict === "pass") break;
      const returned = store.countArtifacts(run.id, node.id, "__ret-input-");
      if (returned >= maxAttempts) throw new Error("входной контроль исчерпал попытки: " + returned + " из " + maxAttempts);
      const rework = reworkAssignment("входной контроль", verdict.findings, verdict.comments, verdict.criteria);
      await cachedCall(store, run, node, "__ret-input-" + (returned + 1), async () => {
        const file = await writeTaskFile(repoRoot, run, ["returns", node.id + "-input-" + String(returned + 1).padStart(2, "0") + ".md"], rework);
        store.appendEvent(run.id, "input.returned", { attempt: returned + 1, maxAttempts, findings: verdict.findings, failedCriteria: verdict.criteria.filter((item) => item.status === "fail"), file }, { stepId: node.id });
        return rework;
      });
      if (supplier) {
        const supplierRoles = await resolveRoles(repoRoot, run, supplier.roles, supplier.id);
        await cachedCall(store, run, node, "__rw-" + (returned + 1), () =>
          runAgentCall({
            repoRoot, store, run, node, state, section: "доработка поставщика", roles: supplierRoles,
            assignment: [
              "Твоя роль назначена поставщиком входа шага \"" + node.title + "\". Входной контроль вернул вход на доработку.",
              "Исправь артефакты входа (" + node.inputs.join(", ") + ") согласно заданию.",
              "",
              rework,
            ].join("\n"),
            verdictRequired: false, lockWorkspace: true,
          }).then((result) => {
            for (const name of node.inputs) {
              store.saveArtifact(run.id, node.id, name, result.output);
              state.artifacts[name] = result.output;
            }
            return result.output;
          }));
      } else {
        // Ручная доработка входа (первый шаг): оператор выбирает вариант, отвечает
        // на уточняющие вопросы контролёра и/или переписывает задание в панели решений.
        const confirmation = await generateInputConfirmation(repoRoot, store, run, node, state, roles, rework).catch(() => ({ variants: [], questions: [] }));
        const resolved = interrupt({
          kind: "input-rework", stepId: node.id, title: node.title,
          assignment: rework, variants: confirmation.variants, questions: confirmation.questions,
          attempts: { used: returned + 1, maxAttempts },
        }) as { answer?: string; questions?: Array<{ question: string; answer: string }> } | null;
        const qa = (resolved?.questions ?? []).filter((item) => item && item.question.trim() && item.answer.trim());
        const answer = [resolved?.answer?.trim() ?? "", ...qa.map((item) => item.question + ": " + item.answer.trim())].filter(Boolean).join("\n\n");
        if (answer) {
          for (const name of node.inputs) {
            store.saveArtifact(run.id, node.id, name, answer);
            state.artifacts[name] = answer;
          }
          const notes = ["# Ответ оператора на доработку входа", "", ...(qa.length ? ["## Уточняющие вопросы", ...qa.map((item) => "- " + item.question + " → " + item.answer), ""] : []), "## Итоговый вход", "", answer];
          await cachedCall(store, run, node, "__ret-input-" + (returned + 1) + "-answer", async () => {
            const file = await writeTaskFile(repoRoot, run, ["returns", node.id + "-input-" + String(returned + 1).padStart(2, "0") + "-answer.md"], notes.join("\n"));
            store.appendEvent(run.id, "input.confirmed", { attempt: returned + 1, questions: qa.map((item) => item.question), file }, { stepId: node.id });
            return notes.join("\n");
          });
        }
      }
    }
  }

  /* -------- 2. Критерии приёмки: статические AC или сгенерированные -------- */
  const outputControl = node.outputControl;
  const generatedAc = outputControl && outputControl.roles.length && !outputControl.ac.length
    ? await generateAcceptanceCriteria(repoRoot, store, run, node, state)
    : [];
  const acList = outputControl?.ac.length ? outputControl.ac : generatedAc;

  /* -------- 3. План по DoD/AC и ручное подтверждение -------- */
  const planLimit = node.inputControl?.maxAttempts ?? 10;
  let plan = "";
  for (;;) {
    const cycle = store.countArtifacts(run.id, node.id, "__plan-");
    const roles = await resolveRoles(repoRoot, run, node.roles, node.id);
    const criteria = [
      outputControl?.dod.length ? "DoD:\n" + outputControl.dod.map((item) => "- " + item).join("\n") : "",
      acList.length ? "AC:\n" + acList.map((item) => "- " + item).join("\n") : "",
    ].filter(Boolean).join("\n\n");
    plan = await cachedCall(store, run, node, "__plan-" + cycle, () =>
      runAgentCall({
        repoRoot, store, run, node, state, section: "план", roles,
        assignment: ["Составь исполнимый план работы шага согласно критериям приёмки.", criteria, node.execution.prompt].filter(Boolean).join("\n\n"),
        verdictRequired: false, lockWorkspace: false,
      }).then((result) => {
        store.appendEvent(run.id, "plan.created", { cycle: cycle + 1 }, { stepId: node.id });
        return result.output;
      }));
    if (!node.execution.confirmPlan) break;
    const rejected = store.countArtifacts(run.id, node.id, "__rejplan-");
    const decision = interrupt({
      kind: "plan-confirm", stepId: node.id, title: node.title, plan,
      attempts: { used: rejected, maxAttempts: planLimit },
    }) as { action?: string; comment?: string } | null;
    if (decision?.action === "approve") {
      store.appendEvent(run.id, "plan.confirmed", {}, { stepId: node.id });
      break;
    }
    if (rejected >= planLimit) throw new Error("подтверждение плана исчерпало попытки: " + rejected + " из " + planLimit);
    const comment = String(decision?.comment ?? "план отклонён без пояснения");
    await cachedCall(store, run, node, "__rejplan-" + (rejected + 1), async () => {
      store.appendEvent(run.id, "plan.rejected", { comment, attempt: rejected + 1 }, { stepId: node.id });
      return comment;
    });
  }

  /* -------- 4. Исполнение и выходной контроль с циклами доработки -------- */
  let work = "";
  let reviewParseFails = 0;
  for (;;) {
    const cycle = store.countArtifacts(run.id, node.id, "__work-");
    const roles = await resolveRoles(repoRoot, run, node.roles, node.id);
    const reworkArtifact = store.latestArtifact(run.id, node.id, "__ret-accept-" + cycle);
    const reworkNote = reworkArtifact?.content ? "\n\n## Задание на доработку предыдущего цикла\n" + reworkArtifact.content : "";
    work = await cachedCall(store, run, node, "__work-" + cycle, async () => {
      const result = await runAgentCall({
        repoRoot, store, run, node, state, section: "исполнение", roles,
        assignment: ["Выполни работу шага по плану.", node.execution.prompt, "## План\n" + plan].filter(Boolean).join("\n\n") + reworkNote,
        verdictRequired: false, lockWorkspace: true,
      });
      const fileName = (node.outputs[0] ?? node.id) + ".md";
      const file = await writeTaskFile(repoRoot, run, [node.id, fileName], result.output);
      for (const name of node.outputs.length ? node.outputs : [node.id]) {
        store.saveArtifact(run.id, node.id, name, result.output, file);
      }
      store.appendEvent(run.id, "step.executed", { cycle: cycle + 1, runtime: result.runtime }, { stepId: node.id });
      return result.output;
    });

    if (node.execution.producesTasks) {
      const tasks = parseTaskList(work);
      if (tasks.length) {
        const existing = await listRoadmapItems(run.workspaceDir);
        let created = 0;
        const agentplane = { created: 0, updated: 0, skipped: 0, unavailable: 0, error: 0, ids: [] as string[], details: [] as string[] };
        for (const task of tasks) {
          const fingerprint = findingFingerprint(task.title, run.workflowId + ":" + node.id);
          if (existing.some((item) => item.provenance.fingerprint === fingerprint)) continue;
          const now = new Date().toISOString();
          const item = await saveRoadmapItem(run.workspaceDir, {
            apiVersion: "harness/v1", kind: "RoadmapItem",
            id: "TASK-" + fingerprint.toUpperCase(),
            title: task.title, description: task.description, type: "task", status: "inbox", priority: "normal",
            labels: ["backlog", run.workflowId], dependencies: [], acceptanceCriteria: [],
            estimate: { value: task.value, effort: task.effort },
            workflowId: run.workflowId, runIds: [run.id], taskRefs: [],
            provenance: { source: "workflow-plan", runId: run.id, fingerprint }, createdAt: now, updatedAt: now,
          });
          created += 1;
          // Зеркало задачи в AgentsPlane: best-effort, недоступность CLI не ломает workflow.
          const sync = await syncTaskToAgentPlane(item, run.workspaceDir);
          if (sync.action === "created" || sync.action === "updated") {
            agentplane[sync.action] += 1;
            if (sync.id) agentplane.ids.push(sync.id);
          } else if (sync.action === "unavailable") {
            agentplane.unavailable += 1;
          } else if (sync.action === "error") {
            agentplane.error += 1;
            if (sync.detail) agentplane.details.push(sync.detail);
          } else {
            agentplane.skipped += 1;
          }
        }
        store.appendEvent(run.id, "plan.tasks-created", {
          count: created,
          agentplane: { ...agentplane, ids: agentplane.ids.slice(0, 10), details: agentplane.details.slice(0, 3) },
        }, { stepId: node.id });
      }
    }

    if (!outputControl || !outputControl.roles.length) break;
    const reviewCycle = store.countArtifacts(run.id, node.id, "__review-");
    const reviewRoles = await resolveRoles(repoRoot, run, outputControl.roles, node.id);
    let reviewFeedback = "";
    // Ключ кеша меняется с каждой попыткой без вердикта: повтор после паузы не получает закешированный плохой ответ.
    const reviewKey = "__review-" + (reviewParseFails ? reviewCycle + "f" + reviewParseFails : reviewCycle);
    const review = await cachedCall(store, run, node, reviewKey, () =>
      runAgentCall({
        repoRoot, store, run, node, state, section: "выходной контроль", roles: reviewRoles,
        assignment: [
          "Проверь результат шага. Категория tests - если требования не выполнены из-за упавших проверок; review - если результат не соответствует критериям.",
          outputControl.tests.length ? "Чек-лист требуемых типов тестов:\n" + outputControl.tests.map((item) => "- " + item).join("\n") : "",
          outputControl.dod.length ? "DoD:\n" + outputControl.dod.map((item) => "- " + item).join("\n") : "",
          acList.length ? "AC:\n" + acList.map((item) => "- " + item).join("\n") : "",
          reviewFeedback,
        ].filter(Boolean).join("\n\n"),
        verdictRequired: true, lockWorkspace: true,
      }).then((result) => result.output));
    let verdict: SectionVerdict;
    try {
      verdict = parseVerdict(review);
    } catch {
      // Вердикта нет - ревью вызывается заново с фидбеком (ключ кеша меняется); после двух неудач - остановка.
      if (reviewParseFails >= 2) throw new Error("выходной контроль дважды не вернул машинный вердикт");
      reviewParseFails += 1;
      store.saveArtifact(run.id, node.id, "__rvfail-" + reviewParseFails, "verdict отсутствует");
      reviewFeedback = "Предыдущий ответ не содержал машинный вердикт - верни строго блок ```json с полями verdict, criteria, findings, comments. Начало предыдущего ответа: " + review.slice(0, 300).trim();
      continue;
    }
    store.appendEvent(run.id, "acceptance.review", { cycle: reviewCycle + 1, verdict: verdict.verdict, category: verdict.category, criteria: verdict.criteria }, { stepId: node.id });

    if (verdict.verdict === "pass") {
      if (!outputControl.manualReview) break;
      const manual = await manualAcceptance(repoRoot, store, run, node, review, verdict.findings, outputControl.maxAttempts, verdict.criteria);
      if (manual === "approved") break;
      continue;
    }

    if (verdict.category === "tests") {
      const cycles = store.countArtifacts(run.id, node.id, "__ret-tests-");
      if (cycles < outputControl.maxAttempts * 2) {
        await writeAcceptanceReturn(repoRoot, store, run, node, "tests", verdict.findings, verdict.comments, verdict.criteria);
        continue;
      }
      // Защитный потолок авто-циклов без расхода попыток: переход к ручному окну.
      const manual = await manualAcceptance(repoRoot, store, run, node, review + "\n\nАвтоматические циклы доработки исчерпаны (" + cycles + ").", verdict.findings, outputControl.maxAttempts, verdict.criteria);
      if (manual === "approved") break;
      continue;
    }

    const rejections = store.countArtifacts(run.id, node.id, "__rej-");
    if (rejections >= outputControl.maxAttempts) throw new Error("выходной контроль исчерпал попытки приёмки: " + rejections + " из " + outputControl.maxAttempts);
    await writeAcceptanceReturn(repoRoot, store, run, node, "review", verdict.findings, verdict.comments, verdict.criteria);
  }

  const outputs = node.outputs.length ? node.outputs : [node.id];
  const artifacts = Object.fromEntries(outputs.map((name) => [name, work]));
  store.appendEvent(run.id, "step.completed", { outputs }, { stepId: node.id });
  return { artifacts, completed: [node.id] };
}

/** Ручное окно приёмки: approve / reject с комментарием / defer (пауза без расхода попыток). */
async function manualAcceptance(
  repoRoot: string,
  store: WorkflowStore,
  run: WorkflowRunRecord,
  node: WorkflowStep,
  summary: string,
  findings: string[],
  maxAttempts: number,
  criteria: CriterionResult[] = [],
): Promise<"approved" | "rejected"> {
  const rejections = store.countArtifacts(run.id, node.id, "__rej-");
  let decision = interrupt({
    kind: "acceptance", stepId: node.id, title: node.title,
    summary: summary.slice(-4000), criteria, attempts: { used: rejections, maxAttempts },
  }) as { action?: string; comment?: string } | null;
  while (decision?.action === "defer") {
    store.appendEvent(run.id, "acceptance.deferred", {}, { stepId: node.id });
    decision = interrupt({
      kind: "acceptance", stepId: node.id, title: node.title,
      summary: summary.slice(-4000), criteria, attempts: { used: rejections, maxAttempts },
    }) as { action?: string; comment?: string } | null;
  }
  if (decision?.action === "approve") {
    store.appendEvent(run.id, "acceptance.approved", { manual: true }, { stepId: node.id });
    return "approved";
  }
  if (rejections >= maxAttempts) throw new Error("выходной контроль исчерпал попытки приёмки: " + rejections + " из " + maxAttempts);
  await writeAcceptanceReturn(repoRoot, store, run, node, "manual", findings, String(decision?.comment ?? "ревью отклонено вручную без пояснения"), criteria);
  return "rejected";
}

/** Возврат на доработку приёмки: файл + артефакты-счётчики (rej расходует попытку, tests - нет). */
async function writeAcceptanceReturn(
  repoRoot: string,
  store: WorkflowStore,
  run: WorkflowRunRecord,
  node: WorkflowStep,
  kind: "tests" | "review" | "manual",
  findings: string[],
  comments: string,
  criteria: CriterionResult[] = [],
): Promise<void> {
  const seq = store.countArtifacts(run.id, node.id, "__ret-accept-") + 1;
  const assignment = reworkAssignment(kind === "tests" ? "упавшие тесты" : "отклонение ревью", findings, comments, criteria);
  const file = await writeTaskFile(repoRoot, run, ["returns", node.id + "-accept-" + String(seq).padStart(2, "0") + ".md"], assignment);
  store.saveArtifact(run.id, node.id, "__ret-accept-" + seq, assignment, file);
  if (kind === "tests") {
    const cycles = store.countArtifacts(run.id, node.id, "__ret-tests-");
    store.saveArtifact(run.id, node.id, "__ret-tests-" + (cycles + 1), assignment);
  } else {
    const rejections = store.countArtifacts(run.id, node.id, "__rej-");
    store.saveArtifact(run.id, node.id, "__rej-" + (rejections + 1), assignment);
  }
  store.appendEvent(run.id, "acceptance.returned", { kind, findings, failedCriteria: criteria.filter((item) => item.status === "fail"), comments, file, attemptConsumed: kind !== "tests" }, { stepId: node.id });
}

function stepRunner(repoRoot: string, store: WorkflowStore, run: WorkflowRunRecord, node: WorkflowStep, supplier: WorkflowStep | null) {
  return async (state: GraphStateValue): Promise<Partial<GraphStateValue>> => {
    try {
      if (node.kind?.startsWith("sprint-")) {
        return await runSprintNode(node, {
          repoRoot, workspaceDir: run.workspaceDir, store, run, state,
          executeWorkflowCommand,
        });
      }
      return await runStepPipeline(repoRoot, store, run, node, supplier, state);
    } catch (error) {
      // Пауза на interrupt (план, приёмка, доработка входа) - не ошибка шага: пробрасываем без записи в журнал.
      if (isGraphBubbleUp(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const n = store.countArtifacts(run.id, node.id, "__err-");
      if (n < 200) {
        const file = await writeTaskFile(repoRoot, run, ["errors", node.id + "-" + String(n + 1).padStart(2, "0") + ".md"], "# Ошибка шага " + node.id + "\n\n" + message + "\n");
        store.saveArtifact(run.id, node.id, "__err-" + (n + 1), message, file);
      }
      store.appendEvent(run.id, "step.failed", { error: message }, { stepId: node.id });
      throw error;
    }
  };
}

/* --------------------- lessons learned: скрытый шаг --------------------- */

interface LessonsProposal {
  target: string;
  kind: "role" | "skill" | "manual";
  title: string;
  diff: string;
  reason: string;
  category: "auto" | "manual";
}

export function parseLessonsProposals(output: string): LessonsProposal[] {
  const blocks = output.match(/```json\s*([\s\S]*?)```/g) ?? [];
  for (const block of [...blocks].reverse()) {
    try {
      const parsed = JSON.parse(block.replace(/^```json\s*/, "").replace(/```\s*$/, "")) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({
          target: String(item.target ?? ""),
          kind: item.kind === "skill" || item.kind === "manual" ? item.kind : "role",
          title: String(item.title ?? ""),
          diff: String(item.diff ?? ""),
          reason: String(item.reason ?? ""),
          category: item.category === "manual" ? "manual" : "auto",
        }));
      }
    } catch { /* не список предложений */ }
  }
  return [];
}

async function lessonsNodeFor(repoRoot: string, run: WorkflowRunRecord, title: string): Promise<WorkflowStep> {
  const lastStep = run.snapshot.nodes.at(-1);
  const roles = await loadRoles(repoRoot);
  const curator = roles.find((role) => role.value.id === "knowledge-curator");
  return {
    ...(lastStep ?? { timeoutMs: 900_000, retry: { maxAttempts: 1 }, resources: { workspace: "read" } } as WorkflowStep),
    id: "lessons",
    title,
    phase: "lessons",
    description: "Скрытый шаг каждого прогона: разбор ошибок и возвратов.",
    dependsOn: [],
    roles: curator ? ["knowledge-curator"] : (lastStep?.roles ?? []),
    runtime: lastStep?.runtime ?? { candidates: [] },
    inputs: [],
    outputs: [],
    execution: { prompt: "", confirmPlan: false, producesTasks: false },
  } as WorkflowStep;
}

async function runLessonsStep(repoRoot: string, store: WorkflowStore, run: WorkflowRunRecord): Promise<void> {
  if (store.latestArtifact(run.id, "lessons", "__lessons-proposals")) return;
  const root = taskRoot(repoRoot, run);
  const notes: string[] = [];
  for (const kind of ["errors", "returns"]) {
    const entries = await readdir(path.join(root, kind), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      const content = await readFile(path.join(root, kind, entry.name), "utf8").catch(() => "");
      if (content.trim()) notes.push("### " + kind + "/" + entry.name + "\n" + content.slice(0, 4000));
    }
  }
  const node = await lessonsNodeFor(repoRoot, run, "Lessons learned");
  const resolved = await resolveRoles(repoRoot, run, node.roles, node.id);
  if (!resolved.length) {
    store.appendEvent(run.id, "lessons.skipped", { reason: "роль knowledge-curator не найдена и шагов в snapshot нет" }, { stepId: "lessons" });
    return;
  }
  const assignment = [
    "Обойди файлы ошибок и возвратов прогона и предложи обновления ролей и навыков.",
    notes.length ? notes.join("\n\n") : "Ошибок и возвратов в прогоне нет; предложи не более одного улучшения профилактического характера или верни пустой список [].",
    "",
    "Формат ответа: последний блок ```json со списком предложений:",
    '[{"target":".agents/roles/<папка>/<роль>.md или id навыка","kind":"role|skill|manual","title":"...","diff":"унифицированный diff","reason":"причина из ошибок/возвратов","category":"auto|manual"}]',
    "category manual - если изменение требует настроек, runtime или ручных действий пользователя.",
  ].join("\n");
  const state = { artifacts: {}, input: run.input } as GraphStateValue;
  const result = await runAgentCall({ repoRoot, store, run, node, state, section: "lessons learned", roles: resolved, assignment, verdictRequired: false, lockWorkspace: false });
  const proposals = parseLessonsProposals(result.output);
  const file = await writeTaskFile(repoRoot, run, ["lessons", "proposals.md"], "# Lessons learned: " + run.title + "\n\n```json\n" + JSON.stringify(proposals, null, 2) + "\n```\n");
  store.saveArtifact(run.id, "lessons", "__lessons-proposals", JSON.stringify(proposals), file);
  store.appendEvent(run.id, "lessons.proposals", {
    total: proposals.length,
    auto: proposals.filter((item) => item.category === "auto").length,
    manual: proposals.filter((item) => item.category === "manual").length,
  }, { stepId: "lessons" });
}

async function applyLessons(repoRoot: string, store: WorkflowStore, run: WorkflowRunRecord, payload: Record<string, unknown>): Promise<void> {
  const proposalsArtifact = store.latestArtifact(run.id, "lessons", "__lessons-proposals");
  if (!proposalsArtifact) throw new Error("предложения lessons learned не найдены");
  const all = parseLessonsJsonArray(proposalsArtifact.content);
  const selected = Array.isArray(payload.selected) ? payload.selected.map(String) : [];
  const chosen = all.filter((item) => selected.includes(item.target));
  if (!chosen.length) throw new Error("не выбрано ни одного предложения");
  let node = await lessonsNodeFor(repoRoot, run, "Lessons learned: применение");
  const runtime = String(payload.runtime ?? "");
  if (runtime && ADAPTERS[runtime]) node = { ...node, runtime: { ...node.runtime, candidates: [runtime] } };
  const resolved = await resolveRoles(repoRoot, run, node.roles, node.id);
  const state = { artifacts: {}, input: run.input } as GraphStateValue;
  const result = await runAgentCall({
    repoRoot, store, run, node, state, section: "lessons apply", roles: resolved,
    assignment: [
      "Примени выбранные улучшения к файлам ролей и навыков. Каждое изменение выполняй точно по diff; причину запиши в комментарий рядом с изменением.",
      "Предложения:",
      JSON.stringify(chosen, null, 2),
    ].join("\n"),
    verdictRequired: false, lockWorkspace: true,
  });
  const file = await writeTaskFile(repoRoot, run, ["lessons", "applied.md"], result.output);
  store.appendEvent(run.id, "lessons.applied", { applied: chosen.length, runtime: result.runtime, file }, { stepId: "lessons" });
}

function parseLessonsJsonArray(content: string): LessonsProposal[] {
  try {
    return parseLessonsProposals("```json\n" + content + "\n```");
  } catch {
    return [];
  }
}

/* ------------------------------ граф прогона ------------------------------ */

/**
 * SqliteSaver зовёт у соединения .pragma(); bun:sqlite (драйвер worker) его
 * не имеет - добавляем шим поверх соединения хранилища. Соединение одно на
 * store и чекпоинтер: без fromConnString и второго better-sqlite3. Методы
 * привязываются к целевому соединению: родные функции bun:sqlite требуют
 * свой внутренний слот и падают с чужим this через Proxy.
 */
function checkpointConnection(db: WorkflowDb): unknown {
  const candidate = db as WorkflowDb & { pragma?: (statement: string) => unknown };
  if (typeof candidate.pragma === "function") return candidate;
  return new Proxy(candidate, {
    get(target, prop) {
      if (prop === "pragma") {
        return (statement: string) => {
          if (statement !== "journal_mode=WAL") throw new Error("чекпоинтер запросил неизвестную прагму: " + statement);
          return target.prepare("PRAGMA journal_mode = WAL").run();
        };
      }
      // bun:sqlite возвращает null из .get() на пустой выборке, better-sqlite3 -
      // undefined; LangGraph читает поля строки без проверки - нормализуем.
      if (prop === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql) as unknown as Record<string, unknown>;
          return new Proxy(statement, {
            get(stmt, stmtProp) {
              const value = Reflect.get(stmt, stmtProp, stmt);
              if (stmtProp === "get" && typeof value === "function") {
                return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(stmt, args) ?? undefined;
              }
              return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(stmt) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function buildGraph(repoRoot: string, store: WorkflowStore, run: WorkflowRunRecord) {
  const selectedIds = run.targetNodes.length
    ? run.targetNodes
    : run.snapshot.nodes.map((node) => node.id);
  const selected = run.snapshot.nodes.filter((node) => selectedIds.includes(node.id));
  const selectedSet = new Set(selectedIds);
  const byId = new Map(selected.map((node) => [node.id, node]));
  const graph = new StateGraph(GraphState) as any;
  for (const node of selected) {
    const supplierId = node.dependsOn.filter((dep) => selectedSet.has(dep)).at(-1);
    graph.addNode(node.id, stepRunner(repoRoot, store, run, node, supplierId ? byId.get(supplierId) ?? null : null));
  }
  const roots = selected.filter((node) => node.dependsOn.filter((dep) => selectedSet.has(dep)).length === 0);
  for (const node of roots) graph.addEdge(START, node.id);
  for (const node of selected) {
    const deps = node.dependsOn.filter((dep) => selectedSet.has(dep));
    if (deps.length === 1) graph.addEdge(deps[0], node.id);
    else if (deps.length > 1) graph.addEdge(deps, node.id);
  }
  const dependents = new Set(selected.flatMap((node) => node.dependsOn.filter((dep) => selectedSet.has(dep))));
  for (const node of selected.filter((candidate) => !dependents.has(candidate.id))) graph.addEdge(node.id, END);
  return graph.compile({ checkpointer: new SqliteSaver(checkpointConnection(store.db) as ConstructorParameters<typeof SqliteSaver>[0]) });
}

export async function executeWorkflowCommand(
  repoRoot: string,
  store: WorkflowStore,
  runId: string,
  command: { type: string; payload: Record<string, unknown> },
): Promise<void> {
  const run = store.getRun(runId);
  if (!run) throw new Error("run не найден: " + runId);
  if (command.type === "cancel" || command.type === "abort") {
    store.updateRun(run.id, "cancelled", { finishedAt: new Date().toISOString(), error: String(command.payload.reason ?? "отменён") });
    store.appendEvent(run.id, "run.cancelled", { reason: command.payload.reason ?? null });
    return;
  }
  if (command.type === "apply-lessons") {
    store.updateRun(run.id, "running", { error: null });
    try {
      await applyLessons(repoRoot, store, run, command.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.updateRun(run.id, "interrupted", { error: message });
      store.appendEvent(run.id, "run.interrupted", { error: message, actions: ["retry", "abort"] });
    }
    return;
  }
  if (command.type === "replace") {
    const stepId = String(command.payload.stepId ?? "");
    const runtime = String(command.payload.runtime ?? "");
    const node = run.snapshot.nodes.find((candidate) => candidate.id === stepId);
    if (!node || (!ADAPTERS[runtime] && !providerPresetById(parseTaskProviderId(runtime) ?? ""))) throw new Error("replace требует совместимые stepId и runtime");
    // Шаг с пустым списком наследует defaults.runtime: replace создаёт явный override.
    const inherited = node.runtime.candidates.length ? node.runtime.candidates : run.snapshot.defaults.runtime?.candidates ?? [];
    node.runtime.candidates = [runtime, ...inherited.filter((id) => id !== runtime)];
    store.updateRunSnapshot(run.id, run.snapshot);
    store.appendEvent(run.id, "step.replaced", { stepId, runtime }, { stepId });
  }
  if (command.type === "restart") {
    // Повтор с самого начала: выходы и маркеры исполнения стираются, чекпоинт сбрасывается.
    // Находки ошибок, возвраты и предложения lessons learned остаются в ledger и в папке задачи.
    store.clearRunArtifacts(run.id);
    store.deleteRunThread(run.id);
    store.appendEvent(run.id, "run.restarted", { scope: "from-start" });
  }
  if (command.type === "retry-from-success") {
    // Повтор с последнего удачного шага: артефакты неуспешных шагов стираются, успешные остаются.
    const completed = store.stepEndStates(run.id).filter((row) => row.type === "step.completed").map((row) => row.stepId);
    store.clearRunArtifacts(run.id, { keepStepIds: completed });
    store.appendEvent(run.id, "run.restarted", { scope: "from-success", keep: completed });
  }
  const graph = buildGraph(repoRoot, store, run);
  const config = { configurable: { thread_id: run.id } };
  store.updateRun(run.id, "running", { startedAt: run.startedAt ?? new Date().toISOString(), error: null });
  store.appendEvent(run.id, command.type === "start" ? "run.started" : "run.resumed", { command: command.type });
  try {
    if (command.type === "skip") {
      const stepId = String(command.payload.stepId ?? "");
      if (!run.snapshot.nodes.some((node) => node.id === stepId)) throw new Error("skip требует stepId");
      await graph.updateState(config, { completed: [stepId] }, stepId);
      store.appendEvent(run.id, "step.skipped", { reason: command.payload.reason ?? null }, { stepId });
    }
    let input: unknown = null;
    if (command.type === "start" || command.type === "restart") {
      input = { runId: run.id, input: run.input, artifacts: {}, completed: [] };
    } else if (command.type === "resume") {
      input = new Command({ resume: command.payload });
    } else if (command.type === "retry" || command.type === "retry-from-success") {
      // Повтор продолжает с чекпоинта; без чекпоинта (старт не удался) - запуск заново.
      const tuple = await (graph as { checkpointer?: { getTuple: (config: unknown) => Promise<unknown> } }).checkpointer?.getTuple(config);
      input = tuple ? null : { runId: run.id, input: run.input, artifacts: {}, completed: [] };
    }
    const result = await graph.invoke(input as any, config);
    if ((result as Record<string, unknown>).__interrupt__) {
      store.updateRun(run.id, "waiting");
      store.appendEvent(run.id, "run.waiting", { interrupts: (result as Record<string, unknown>).__interrupt__ });
      return;
    }
    await runLessonsStep(repoRoot, store, run).catch((error) => {
      store.appendEvent(run.id, "lessons.failed", { error: error instanceof Error ? error.message : String(error) }, { stepId: "lessons" });
    });
    store.updateRun(run.id, "completed", { finishedAt: new Date().toISOString(), error: null });
    store.appendEvent(run.id, "run.completed", { completed: result.completed ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateRun(run.id, "interrupted", { error: message });
    store.appendEvent(run.id, "run.interrupted", { error: message, actions: ["retry", "skip", "replace", "abort"] });
  }
}
