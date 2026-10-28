import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeProviderRequest } from "./providerRun";
import { launchPromptRun } from "./prompts";
import { finishTaskMeta, newTaskId, saveTaskMeta } from "./tasks";
import { parseCodexStream, parseJsonEnvelope, waitForProcess } from "./workflows/engine";
import { loadInternalSkills } from "./workflows/catalog";
import { isActiveProvider, parseTaskProviderId, providerBaseUrlError, providerPresetById } from "./providers";
import { resolveProviderToken } from "./providerAuth";
import { readProviderEntry } from "./providerSettings";
import { loadConsoleState, resolveDefaultProvider, resolveOptimizationExecutor, type ConsoleState } from "./state";
import { ADAPTERS } from "@/runtimes";

/**
 * Раннер evals master-навыков (аналог judge + report из harness2): кейсы из
 * evals/evals.json исполняются у выбранного рантайма (headless) или провайдера,
 * судья-провайдер проверяет утверждения кейса, отчёт пишется в папку задачи.
 * Оркестрация - отдельный процесс (skill-evals-runner.ts), запускается из API
 * startSkillEvalsRun; прогресс виден в report.json после каждого кейса.
 */

/** Потолок одного кейса: headless-рантайм может работать минутами. */
export const CASE_TIMEOUT_MS = 10 * 60_000;
/** Потолок фактического ответа в промпте судьи. */
const JUDGE_OUTPUT_LIMIT = 16_000;

export interface SkillEvalCase {
  id: string;
  prompt: string;
  expectedOutput: string;
  assertions: string[];
}

export interface SkillEvalEntry {
  skillId: string;
  title: string;
  tags: string[];
  /** Каталог навыка - источник evals/evals.json. */
  sourceDir: string;
  /** Содержимое SKILL.md - методология, внедряемая в промпт кейса. */
  content: string;
  cases: SkillEvalCase[];
}

export interface AssertionVerdict {
  text: string;
  pass: boolean;
  note: string;
}

export interface CaseVerdict {
  pass: boolean;
  assertions: AssertionVerdict[];
  comment: string;
}

export interface CaseResult {
  skillId: string;
  caseId: string;
  runtime: string;
  /** Исполнение кейса прошло и ответ получен. */
  ok: boolean;
  error: string | null;
  output: string;
  usage: Record<string, unknown> | null;
  costUsd: number | null;
  verdict: CaseVerdict | null;
  durationMs: number;
}

export interface SkillEvalsReport {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  /** Судья: provider:<id> и модель standard. */
  judge: string;
  judgeModel: string | null;
  runtimes: string[];
  skills: Array<{ skillId: string; title: string; caseCount: number }>;
  results: CaseResult[];
  /** Сообщение о неисправимой ошибке оркестрации. */
  error: string | null;
}

/** Разбор evals/evals.json: список кейсов с утверждениями. */
export function parseEvalsJson(text: string): SkillEvalCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const evals = (parsed as { evals?: unknown })?.evals;
  if (!Array.isArray(evals)) return [];
  const cases: SkillEvalCase[] = [];
  for (const item of evals) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const prompt = String(record.prompt ?? "").trim();
    if (!prompt) continue;
    cases.push({
      id: String(record.id ?? "case-" + (cases.length + 1)),
      prompt,
      expectedOutput: String(record.expected_output ?? record.expectedOutput ?? ""),
      assertions: Array.isArray(record.assertions) ? record.assertions.map((line) => String(line)).filter((line) => line.trim()) : [],
    });
  }
  return cases;
}

/** Каталог навыков с evals: мастер-каталог и design-группа, только с непустым набором кейсов. */
export async function readSkillEvalsCatalog(repoRoot: string): Promise<SkillEvalEntry[]> {
  const entries: SkillEvalEntry[] = [];
  for (const skill of await loadInternalSkills(repoRoot)) {
    const file = path.join(path.dirname(skill.sourceFile), "evals", "evals.json");
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    const cases = parseEvalsJson(text);
    if (!cases.length) continue;
    entries.push({
      skillId: skill.value.id,
      title: skill.value.title,
      tags: skill.value.tags,
      sourceDir: path.dirname(skill.sourceFile),
      content: skill.content,
      cases,
    });
  }
  return entries;
}

/** Промпт кейса: методология навыка + рабочий запрос; без вызова инструментов. */
export function buildCasePrompt(entry: Pick<SkillEvalEntry, "skillId" | "title" | "content">, evalCase: SkillEvalCase): string {
  return [
    `Ты применяешь master-навык "${entry.skillId}" ("${entry.title}"). Ниже - методология навыка и рабочий запрос. Выполни запрос строго по методологии.`,
    "Инструменты не вызывай и файлы не создавай: весь ответ - текст на русском языке в Markdown по структуре, требуемой методологией.",
    "",
    "## Методология навыка (SKILL.md)",
    entry.content,
    "",
    "## Рабочий запрос",
    evalCase.prompt,
  ].join("\n");
}

/** Промпт судьи: утверждения кейса проверяются по фактическому ответу; ответ - строгий JSON. */
export function buildJudgePrompt(evalCase: SkillEvalCase, output: string): string {
  return [
    "Ты - судья оценки исполнения master-навыка. Ниже - рабочий запрос, ожидаемый результат, утверждения и фактический ответ исполнителя.",
    "Проверь каждое утверждение только по фактическому ответу; не домысливай отсутствующее.",
    'Верни СТРОГО один JSON-объект без пояснений и markdown-обёртки, формат: {"pass":true|false,"assertions":[{"text":"утверждение дословно","pass":true,"note":"пояснение"}],"comment":"краткий вывод"}.',
    'Поле "pass" истинно, только если пройдены все утверждения. Тексты на русском языке.',
    "",
    "## Рабочий запрос",
    evalCase.prompt,
    "",
    "## Ожидаемый результат",
    evalCase.expectedOutput || "(не задан)",
    "",
    "## Утверждения",
    ...(evalCase.assertions.length ? evalCase.assertions.map((line) => "- " + line) : ["- (не заданы; оцени соответствие ожидаемому результату)"]),
    "",
    "## Фактический ответ исполнителя",
    output.slice(0, JUDGE_OUTPUT_LIMIT) || "(пустой ответ)",
  ].join("\n");
}

/** Разбор вердикта судьи: весь текст или первый JSON-объект. */
export function parseJudgeVerdict(text: string): CaseVerdict | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || !("pass" in parsed)) continue;
      const assertions = Array.isArray(parsed.assertions)
        ? parsed.assertions
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .map((item) => ({ text: String(item.text ?? ""), pass: item.pass === true, note: String(item.note ?? "") }))
        : [];
      return { pass: parsed.pass === true, assertions, comment: String(parsed.comment ?? "") };
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

/* --------------------------- исполнение кейса --------------------------- */

/** Конфигурация провайдера-судьи; строка ошибки при недоступности. */
export async function resolveJudgeProvider(repoRoot: string, state: ConsoleState): Promise<{ providerId: string; model: string; entry: Awaited<ReturnType<typeof readProviderEntry>>; baseUrl: string; preset: NonNullable<ReturnType<typeof providerPresetById>> } | string> {
  const executor = resolveOptimizationExecutor(state);
  const providerId = parseTaskProviderId(executor) ?? resolveDefaultProvider(state);
  const preset = providerPresetById(providerId);
  if (!preset) return `провайдер не найден в реестре: ${providerId}`;
  const entry = await readProviderEntry(repoRoot, preset, state.providers?.entries?.[providerId] ?? null);
  if (!isActiveProvider(preset, entry)) {
    return `провайдер ${preset.label} не активен - заполните поля и пройдите проверку на вкладке "Провайдеры"`;
  }
  const model = entry.models.standard.trim();
  if (!model) return `у провайдера ${preset.label} не задана модель standard`;
  const baseUrlError = providerBaseUrlError(entry.baseUrl, preset.kind);
  if (baseUrlError) return baseUrlError;
  const precheck = await resolveProviderToken(preset, entry);
  if (!precheck.ok) return precheck.error;
  return { providerId, model, entry, baseUrl: entry.baseUrl.trim(), preset };
}

/** Исполнение кейса у провайдера (provider:<id>): синхронный запрос в процессе раннера. */
async function executeViaProvider(
  judge: { preset: NonNullable<ReturnType<typeof providerPresetById>>; providerId: string; model: string; entry: Awaited<ReturnType<typeof readProviderEntry>>; baseUrl: string },
  prompt: string,
): Promise<{ output: string; usage: Record<string, unknown> | null; costUsd: number | null }> {
  const result = await executeProviderRequest({ preset: judge.preset, providerId: judge.providerId, model: judge.model, prompt, entry: judge.entry, baseUrl: judge.baseUrl });
  if (!result.ok) throw new Error(result.error);
  return { output: result.text, usage: null, costUsd: null };
}

/** Исполнение кейса в headless-рантайме: спавн, ожидание, разбор конверта или лога. */
export async function executeViaRuntime(opts: {
  repoRoot: string;
  runtimeId: string;
  prompt: string;
  timeoutMs?: number;
  /** Рабочая папка запуска (например, worktree пробы); по умолчанию - корень репозитория. */
  cwd?: string;
  /** Correlation пробы: идентификаторы попадают в HARNESS_* env и статистику. */
  correlation?: { workflowRunId: string; workflowStepId: string; agentId?: string; parentAgentId?: string };
}): Promise<{ output: string; usage: Record<string, unknown> | null; costUsd: number | null; logFile: string }> {
  const adapter = ADAPTERS[opts.runtimeId];
  if (!adapter) throw new Error("неизвестный рантайм: " + opts.runtimeId);
  const launched = await launchPromptRun({
    repoRoot: opts.repoRoot,
    adapter,
    runtimeId: opts.runtimeId,
    prompt: opts.prompt,
    cwd: opts.cwd,
    correlation: opts.correlation,
    outputFormat: adapter.headlessJson ? "json" : undefined,
    jsonStream: opts.runtimeId === "codex",
  });
  if (!launched.ok) throw new Error(launched.detail);
  await waitForProcess(launched.pid, { timeoutMs: opts.timeoutMs ?? CASE_TIMEOUT_MS });
  const log = await readFile(launched.logFile, "utf8").catch(() => "");
  if (opts.runtimeId === "codex") {
    const stream = parseCodexStream(log);
    if (stream) return { output: stream.result, usage: stream.usage, costUsd: null, logFile: launched.logFile };
  } else {
    const envelope = parseJsonEnvelope(log);
    if (envelope) return { output: envelope.result, usage: envelope.usage, costUsd: envelope.costUsd ?? null, logFile: launched.logFile };
  }
  return { output: log.trim().slice(0, 24_000), usage: null, costUsd: null, logFile: launched.logFile };
}

/* ------------------------------ отчёты задач ------------------------------ */

export function skillEvalsDir(repoRoot: string, id: string): string {
  return path.join(repoRoot, ".agents", "console", "tasks", id, "skill-evals");
}

async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = file + ".tmp";
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

export async function readSkillEvalsReport(repoRoot: string, id: string): Promise<SkillEvalsReport | null> {
  const raw = await readFile(path.join(skillEvalsDir(repoRoot, id), "report.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SkillEvalsReport>;
    if (typeof parsed.id !== "string") return null;
    return { ...parsed, results: Array.isArray(parsed.results) ? parsed.results : [] } as SkillEvalsReport;
  } catch {
    return null;
  }
}

/** Сводка отчёта для списка: pass-rate по навыку и рантайму. */
export interface SkillEvalsSummary {
  id: string;
  status: SkillEvalsReport["status"];
  startedAt: string;
  finishedAt: string | null;
  judge: string;
  runtimes: string[];
  skills: Array<{ skillId: string; title: string; caseCount: number; passed: number; judged: number }>;
  totals: { cases: number; passed: number; failed: number; errors: number };
}

export function summarizeReport(report: SkillEvalsReport): SkillEvalsSummary {
  const bySkill = new Map<string, { title: string; caseCount: number; passed: number; judged: number }>();
  let passed = 0;
  let failed = 0;
  let errors = 0;
  for (const meta of report.skills) {
    bySkill.set(meta.skillId, { title: meta.title, caseCount: meta.caseCount, passed: 0, judged: 0 });
  }
  for (const result of report.results) {
    const entry = bySkill.get(result.skillId);
    if (!result.ok) {
      errors += 1;
      continue;
    }
    if (!result.verdict) {
      errors += 1;
      continue;
    }
    if (entry) {
      entry.judged += 1;
      if (result.verdict.pass) entry.passed += 1;
    }
    if (result.verdict.pass) passed += 1;
    else failed += 1;
  }
  return {
    id: report.id,
    status: report.status,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    judge: report.judge,
    runtimes: report.runtimes,
    skills: [...bySkill.entries()].map(([skillId, value]) => ({ skillId, ...value })),
    totals: { cases: report.results.length, passed, failed, errors },
  };
}

/** Список сводок всех прогонов evals (новые сверху). */
export async function listSkillEvalsSummaries(repoRoot: string): Promise<SkillEvalsSummary[]> {
  const tasksRoot = path.join(repoRoot, ".agents", "console", "tasks");
  const dirs = await readdir(tasksRoot, { withFileTypes: true }).catch(() => []);
  const summaries: SkillEvalsSummary[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const report = await readSkillEvalsReport(repoRoot, dir.name);
    if (report) summaries.push(summarizeReport(report));
  }
  return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Markdown-отчёт прогона: сводная таблица и результаты по кейсам. */
export function renderReportMarkdown(report: SkillEvalsReport): string {
  const lines = [
    "# Оценка навыков: " + report.id,
    "",
    `- Статус: ${report.status}`,
    `- Начало: ${report.startedAt}; окончание: ${report.finishedAt ?? "-"}`,
    `- Рантаймы: ${report.runtimes.join(", ")}`,
    `- Судья: ${report.judge} (${report.judgeModel ?? "-"})`,
    "",
    "| Навык | Кейсов | Пройдено |",
    "|---|---|---|",
  ];
  const summary = summarizeReport(report);
  for (const skill of summary.skills) {
    lines.push(`| ${skill.title} (${skill.skillId}) | ${skill.caseCount} | ${skill.passed}/${skill.judged || 0} |`);
  }
  lines.push("", "## Результаты по кейсам", "");
  for (const result of report.results) {
    const verdict = result.verdict ? (result.verdict.pass ? "pass" : "fail") : "не оценено";
    lines.push(
      `### ${result.skillId} / ${result.caseId} - ${result.runtime}: ${result.ok ? verdict : "ошибка исполнения"}`,
      "",
      result.error ? `- Ошибка: ${result.error}` : "",
      result.verdict?.comment ? `- Вывод судьи: ${result.verdict.comment}` : "",
      ...(result.verdict?.assertions ?? []).map((item) => `- ${item.pass ? "pass" : "fail"}: ${item.text}${item.note ? " - " + item.note : ""}`),
      "",
    );
  }
  return lines.filter((line) => line !== "").join("\n") + "\n";
}

/* ------------------------------ оркестрация ------------------------------ */

/** Запуск прогона evals: создать задачу и отвязанный процесс раннера. */
export async function startSkillEvalsRun(
  repoRoot: string,
  state: ConsoleState,
  input: { skillIds: string[]; runtimes: string[] },
): Promise<{ ok: true; id: string; pid: number | null; detail: string } | { ok: false; error: string }> {
  const catalog = await readSkillEvalsCatalog(repoRoot);
  const skillIds = input.skillIds.filter((id) => catalog.some((entry) => entry.skillId === id));
  if (!skillIds.length) {
    return { ok: false, error: "навыки с evals не выбраны или не найдены" };
  }
  const runtimes = input.runtimes.filter((runtimeId) => parseTaskProviderId(runtimeId) !== null || Boolean(ADAPTERS[runtimeId]));
  if (!runtimes.length) {
    return { ok: false, error: "исполнители не выбраны или неизвестны" };
  }
  const judge = await resolveJudgeProvider(repoRoot, state);
  if (typeof judge === "string") return { ok: false, error: "судья недоступен: " + judge };

  const id = newTaskId();
  const dir = skillEvalsDir(repoRoot, id);
  await mkdir(dir, { recursive: true });
  const report: SkillEvalsReport = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    judge: "provider:" + judge.providerId,
    judgeModel: judge.model,
    runtimes,
    skills: catalog
      .filter((entry) => skillIds.includes(entry.skillId))
      .map((entry) => ({ skillId: entry.skillId, title: entry.title, caseCount: entry.cases.length })),
    results: [],
    error: null,
  };
  await atomicWrite(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");

  const runsDir = path.join(repoRoot, ".agents", "console", "runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const logFile = path.join(runsDir, `${stamp}-skill-evals.log`);
  const entry = path.join(repoRoot, "apps", "console", "src", "skill-evals-runner.ts");
  const fh = await open(logFile, "a");
  const child = spawn("bun", [entry, repoRoot, id], {
    cwd: repoRoot,
    env: { ...process.env, HARNESS_SKILL_EVALS: "1" },
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  });
  child.unref();
  await fh.close();

  await saveTaskMeta(repoRoot, {
    kind: "skill-evals",
    title: `Оценка навыков: ${report.skills.map((skill) => skill.skillId).join(", ")}`,
    executor: { type: "provider", id: judge.providerId },
    model: judge.model,
    pid: child.pid ?? null,
    sessionRuntime: null,
    logFile,
    detail: `исполнители: ${runtimes.join(", ")}`,
  }, id).catch(() => undefined);

  return {
    ok: true,
    id,
    pid: child.pid ?? null,
    detail: `прогон evals запущен (${runtimes.join(", ")}; судья provider:${judge.providerId}); задача - в Мониторинг → Задачи`,
  };
}

/**
 * Полный прогон evals в процессе раннера: исполняет кейсы последовательно,
 * после каждого кейса обновляет report.json, в конце пишет report.md и
 * финализирует мету задачи. Ошибка исполнения одного кейса не останавливает
 * прогон; неисправимая ошибка оркестрации завершает прогон со статусом failed.
 */
export async function runSkillEvalsJob(repoRoot: string, id: string): Promise<void> {
  const report = await readSkillEvalsReport(repoRoot, id);
  if (!report || report.status !== "running") {
    process.stderr.write("skill-evals: задача не найдена или уже завершена: " + id + "\n");
    process.exit(1);
  }
  let failed = false;
  try {
    const state = await loadConsoleState(repoRoot);
    const judge = await resolveJudgeProvider(repoRoot, state);
    if (typeof judge === "string") throw new Error("судья недоступен: " + judge);
    const catalog = await readSkillEvalsCatalog(repoRoot);
    const reportFile = path.join(skillEvalsDir(repoRoot, id), "report.json");

    for (const runtimeId of report.runtimes) {
      for (const meta of report.skills) {
        const entry = catalog.find((item) => item.skillId === meta.skillId);
        if (!entry) continue;
        for (const evalCase of entry.cases) {
          const startedMs = Date.now();
          const result: CaseResult = {
            skillId: entry.skillId,
            caseId: evalCase.id,
            runtime: runtimeId,
            ok: false,
            error: null,
            output: "",
            usage: null,
            costUsd: null,
            verdict: null,
            durationMs: 0,
          };
          try {
            const prompt = buildCasePrompt(entry, evalCase);
            const executed = parseTaskProviderId(runtimeId)
              ? await executeViaProvider(judge, prompt)
              : await executeViaRuntime({ repoRoot, runtimeId, prompt });
            result.ok = true;
            result.output = executed.output;
            result.usage = executed.usage;
            result.costUsd = executed.costUsd;
          } catch (error) {
            result.ok = false;
            result.error = error instanceof Error ? error.message : String(error);
          }
          if (result.ok) {
            try {
              const judged = await executeProviderRequest({
                preset: judge.preset, providerId: judge.providerId, model: judge.model,
                prompt: buildJudgePrompt(evalCase, result.output), entry: judge.entry, baseUrl: judge.baseUrl,
              });
              if (judged.ok) {
                result.verdict = parseJudgeVerdict(judged.text);
                if (!result.verdict) result.error = "судья вернул ответ не в формате JSON";
              } else {
                result.error = "судья недоступен: " + judged.error;
              }
            } catch (error) {
              result.error = "ошибка судьи: " + (error instanceof Error ? error.message : String(error));
            }
          }
          result.durationMs = Date.now() - startedMs;
          report.results.push(result);
          await atomicWrite(reportFile, JSON.stringify(report, null, 2) + "\n");
        }
      }
    }
  } catch (error) {
    failed = true;
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.status = failed ? "failed" : "completed";
  report.finishedAt = new Date().toISOString();
  const dir = skillEvalsDir(repoRoot, id);
  await atomicWrite(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(dir, "report.md"), renderReportMarkdown(report), "utf8");
  await finishTaskMeta(repoRoot, id, failed ? "failed" : "completed");
}
