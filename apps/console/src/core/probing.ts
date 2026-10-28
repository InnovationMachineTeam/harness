import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { adoptedLessonsBlock, listLessons } from "./lessonsLibrary";
import { finishTaskMeta, newTaskId, saveTaskMeta } from "./tasks";
import { executeProviderRequest } from "./providerRun";
import { executeViaRuntime, resolveJudgeProvider } from "./skillEvals";
import { loadConsoleState, mandatoryWorkspace, type ConsoleState } from "./state";
import { ADAPTERS } from "@/runtimes";

/**
 * Контрастивные пробы обвеса (метод propose-probe-compose из harness2): одна
 * задача выполняется в N вариантах обвеса в изолированных worktree, поведение
 * вариантов сравнивается провайдером без эталона, лучший вариант принимает
 * оператор. Вариант = блок дополнительных инструкций в промпте + замены файлов
 * обвеса (whitelist: роли, SKILL.md, AGENTS.md), применяемые только в worktree
 * варианта. Оркестрация - отдельный процесс (probe-runner.ts).
 */

/** Потолок вариантов одной пробы (одновременные отвязанные процессы). */
export const PROBE_MAX_VARIANTS = 4;
export const PROBE_TIMEOUT_MS = 20 * 60_000;
const TASK_PROMPT_LIMIT = 8_000;
const CONTEXT_BLOCK_LIMIT = 4_000;
const OVERRIDE_FILE_LIMIT = 64_000;
const OVERRIDE_COUNT_LIMIT = 4;
const CONTRAST_OUTPUT_LIMIT = 4_000;

export interface ProbeFileOverride {
  /** Путь относительно корня рабочей папки; whitelist - overridePathAllowed. */
  path: string;
  content: string;
}

export interface ProbeVariant {
  id: string;
  label: string;
  contextBlock: string;
  fileOverrides: ProbeFileOverride[];
}

export interface ProbeVariantResult {
  variantId: string;
  label: string;
  worktree: string;
  branch: string;
  ok: boolean;
  error: string | null;
  output: string;
  usage: Record<string, unknown> | null;
  costUsd: number | null;
  durationMs: number;
}

export interface ProbeRecommendation {
  variantId: string | null;
  rationale: string;
}

export interface ProbeRun {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  workspaceDir: string;
  runtimeId: string;
  model: string | null;
  taskPrompt: string;
  variants: ProbeVariant[];
  results: ProbeVariantResult[];
  /** Контрастный отчёт провайдера (Markdown). */
  contrast: string | null;
  recommendation: ProbeRecommendation | null;
  /** Вариант, принятый оператором; внедрение - запуск агента на применение замен. */
  adoptedVariantId: string | null;
  error: string | null;
}

/** Разрешённые замены файлов обвеса: роли, SKILL.md мастер-навыков, AGENTS.md. */
export function overridePathAllowed(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) return false;
  if (normalized === "AGENTS.md") return true;
  if (normalized.startsWith(".agents/roles/")) return true;
  if (normalized.startsWith(".agents/skills/") && normalized.endsWith("/SKILL.md")) return true;
  return false;
}

/** Валидация и санитизация вариантов пробы; строка ошибки при нарушении ограничений. */
export function parseVariantsInput(raw: unknown): { variants: ProbeVariant[] } | string {
  if (!Array.isArray(raw) || raw.length === 0) return "нужен непустой список вариантов";
  if (raw.length > PROBE_MAX_VARIANTS) return `не больше ${PROBE_MAX_VARIANTS} вариантов в пробе`;
  const variants: ProbeVariant[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return "вариант должен быть объектом";
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? "").trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id) || id.includes("..")) return "id варианта: латинские буквы, цифры, точка, дефис";
    if (seen.has(id)) return "id вариантов должны быть уникальны: " + id;
    seen.add(id);
    const label = String(record.label ?? id).trim().slice(0, 120) || id;
    const contextBlock = String(record.contextBlock ?? "").replace(/\0/g, " ").slice(0, CONTEXT_BLOCK_LIMIT);
    const fileOverrides: ProbeFileOverride[] = [];
    const overridesRaw = Array.isArray(record.fileOverrides) ? record.fileOverrides : [];
    if (overridesRaw.length > OVERRIDE_COUNT_LIMIT) return `не больше ${OVERRIDE_COUNT_LIMIT} замен файлов в варианте ${id}`;
    for (const overrideRaw of overridesRaw) {
      if (!overrideRaw || typeof overrideRaw !== "object") return "замена файла должна быть объектом {path, content}";
      const override = overrideRaw as Record<string, unknown>;
      const filePath = String(override.path ?? "");
      if (!overridePathAllowed(filePath)) return "путь замены вне whitelist (роли, SKILL.md, AGENTS.md): " + filePath;
      fileOverrides.push({ path: filePath.replace(/\\/g, "/").replace(/^\.?\//, ""), content: String(override.content ?? "").slice(0, OVERRIDE_FILE_LIMIT) });
    }
    variants.push({ id, label, contextBlock, fileOverrides });
  }
  return { variants };
}

function insideRoot(root: string, ...segments: string[]): string {
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("недопустимый путь за границами корня: " + segments.join("/"));
  return target;
}

export function probeArtifactsDir(repoRoot: string, id: string): string {
  return path.join(repoRoot, ".agents", "console", "tasks", id, "probe");
}

async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = file + ".tmp";
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

export async function readProbeRun(repoRoot: string, id: string): Promise<ProbeRun | null> {
  const raw = await readFile(path.join(probeArtifactsDir(repoRoot, id), "probe.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProbeRun>;
    if (typeof parsed.id !== "string") return null;
    return { ...parsed, variants: Array.isArray(parsed.variants) ? parsed.variants : [], results: Array.isArray(parsed.results) ? parsed.results : [] } as ProbeRun;
  } catch {
    return null;
  }
}

async function writeProbeRun(repoRoot: string, run: ProbeRun): Promise<void> {
  const dir = probeArtifactsDir(repoRoot, run.id);
  await mkdir(dir, { recursive: true });
  await atomicWrite(path.join(dir, "probe.json"), JSON.stringify(run, null, 2) + "\n");
}

/** Применить замены файлов варианта в каталоге (worktree); пути уже в whitelist. */
export async function applyOverrides(targetDir: string, overrides: ProbeFileOverride[]): Promise<void> {
  for (const override of overrides) {
    const file = insideRoot(targetDir, override.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, override.content, "utf8");
  }
}

/** Промпт задачи с блоком дополнительных инструкций варианта. */
export function buildProbePrompt(taskPrompt: string, variant: Pick<ProbeVariant, "id" | "label" | "contextBlock">): string {
  return [
    taskPrompt,
    "",
    '## Дополнительные инструкции обвеса (вариант "' + variant.label + '")',
    variant.contextBlock.trim() || "(пусто - работай по базовым правилам)",
    "",
    "Работай по правилам AGENTS.md этой папки. Ответ заверши разделом \"Итог\": что сделано, какие файлы изменены, как проверить.",
  ].join("\n");
}

/** Разбор рекомендации из контрастного отчёта: последний ```json-блок. */
export function parseRecommendation(text: string): ProbeRecommendation | null {
  const blocks = text.match(/```json\s*([\s\S]*?)```/g) ?? [];
  for (const block of [...blocks].reverse()) {
    try {
      const parsed = JSON.parse(block.replace(/^```json\s*/, "").replace(/```\s*$/, "")) as Record<string, unknown>;
      if ("variantId" in parsed) {
        const variantId = parsed.variantId === null || parsed.variantId === "" ? null : String(parsed.variantId);
        return { variantId, rationale: String(parsed.rationale ?? "") };
      }
    } catch {
      // следующий блок
    }
  }
  return null;
}

/** Промпт контрастного сравнения: варианты без эталона, рекомендация в JSON-блоке. */
export function buildContrastPrompt(run: Pick<ProbeRun, "taskPrompt" | "variants">, results: ProbeVariantResult[]): string {
  const lines = [
    "Ты - аналитик контрастивных прогонов агентного обвеса. Одна задача выполнена в нескольких вариантах обвеса; эталонного ответа нет.",
    "Сравни поведение вариантов между собой: полнота решения, соответствие заданию, различия подхода, стоимость (если известна).",
    "Верни Markdown-отчёт с разделом \"## Контраст вариантов\" (по одному подразделу на вариант) и заверши ответ блоком:",
    '```json\n{"variantId":"<id лучшего варианта или null>","rationale":"обоснование в 1-3 предложениях"}\n```',
    "Не рекомендуй вариант, завершившийся ошибкой исполнения.",
    "",
    "## Задача",
    run.taskPrompt,
    "",
    "## Варианты",
  ];
  for (const variant of run.variants) {
    const result = results.find((item) => item.variantId === variant.id);
    lines.push(
      `### ${variant.id} - ${variant.label}`,
      `- Дополнительные инструкции: ${variant.contextBlock.trim() ? "заданы" : "не заданы"}; замен файлов: ${variant.fileOverrides.length}`,
      result
        ? `- Исход: ${result.ok ? "исполнено" : "ошибка (" + (result.error ?? "?") + ")"}; длительность ${Math.round(result.durationMs / 1000)} с; стоимость: ${result.costUsd ?? "неизвестна"}`
        : "- Исход: данных нет",
      result?.output ? "- Ответ (первые символы): " + result.output.replace(/\s+/g, " ").slice(0, CONTRAST_OUTPUT_LIMIT) : "",
    );
  }
  return lines.filter((line) => line !== "").join("\n");
}

/** Промпт генерации вариантов: задача + принятые уроки -> k блоков инструкций. */
export function buildProposePrompt(taskPrompt: string, k: number, lessonsBlock: string): string {
  return [
    `Ты - конструктор агентного обвеса. Предложи ${k} варианта ДОПОЛНИТЕЛЬНЫХ инструкций обвеса для контрастивной проверки одной задачи.`,
    "Каждый вариант - короткий блок инструкций (3-10 строк), который меняет поведение агента на этой задаче: структура работы, порядок проверки, роль, строгость правил.",
    "Варианты должны быть различимы между собой; опирайся на принятые уроки, если они релевантны задаче.",
    "Верни СТРОГО один JSON-объект без markdown-обёртки: {\"variants\":[{\"id\":\"короткий-латинский-идентификатор\",\"label\":\"краткое имя\",\"contextBlock\":\"инструкции\"}]}. Тексты на русском языке.",
    "",
    "## Задача",
    taskPrompt,
    "",
    lessonsBlock || "Принятых уроков в библиотеке нет.",
  ].join("\n");
}

/** Разбор предложенных вариантов из ответа провайдера. */
export function parseProposedVariants(text: string, k: number): ProbeVariant[] {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { variants?: unknown };
      if (!Array.isArray(parsed.variants)) continue;
      const validated = parseVariantsInput(parsed.variants.slice(0, k));
      if (typeof validated === "string") continue;
      return validated.variants;
    } catch {
      // следующий кандидат
    }
  }
  return [];
}

/* ------------------------------ оркестрация ------------------------------ */

function worktreeSlug(probeId: string, index: number): string {
  return `probe-${probeId}-${index}`;
}

/** Создать worktree варианта; возвращает путь и ветку. */
export function createVariantWorktree(workspaceDir: string, probeId: string, index: number): { worktree: string; branch: string; slug: string } {
  const base = insideRoot(workspaceDir, ".agents", ".worktrees");
  const slug = worktreeSlug(probeId, index);
  const worktree = insideRoot(base, slug);
  const branch = slug;
  const result = spawnSync("git", ["worktree", "add", worktree, "-b", branch], { cwd: workspaceDir, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0 && !/already exists|already registered/.test(String(result.stderr ?? ""))) {
    throw new Error("worktree не создан: " + String(result.stderr || result.stdout || "").trim().slice(0, 300));
  }
  return { worktree, branch, slug };
}

/** Удалить worktree варианта штатным скриптом (worktree:remove). */
export function removeVariantWorktree(repoRoot: string, slug: string): void {
  if (!/^probe-[A-Za-z0-9._-]+-\d+$/.test(slug)) return;
  spawnSync("bun", ["tooling/scripts/src/worktree.ts", slug, "--force"], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
}

/** Запуск пробы: создать задачу, worktree - в процессе раннера. */
export async function startProbeRun(
  repoRoot: string,
  state: ConsoleState,
  input: { taskPrompt: string; variants: unknown; runtimeId: string; workspaceDir?: string },
): Promise<{ ok: true; id: string; pid: number | null; detail: string } | { ok: false; error: string }> {
  const taskPrompt = input.taskPrompt.replace(/\0/g, " ").trim().slice(0, TASK_PROMPT_LIMIT);
  if (!taskPrompt) return { ok: false, error: "текст задачи пуст" };
  const variants = parseVariantsInput(input.variants);
  if (typeof variants === "string") return { ok: false, error: variants };
  const adapter = ADAPTERS[input.runtimeId];
  if (!adapter) return { ok: false, error: "неизвестный рантайм: " + input.runtimeId };

  const id = newTaskId();
  const run: ProbeRun = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    workspaceDir: input.workspaceDir ?? mandatoryWorkspace(state),
    runtimeId: input.runtimeId,
    model: null,
    taskPrompt,
    variants: variants.variants,
    results: [],
    contrast: null,
    recommendation: null,
    adoptedVariantId: null,
    error: null,
  };
  await writeProbeRun(repoRoot, run);

  const runsDir = path.join(repoRoot, ".agents", "console", "runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = run.startedAt.replace(/[:.]/g, "-");
  const logFile = path.join(runsDir, `${stamp}-probe.log`);
  const entry = path.join(repoRoot, "apps", "console", "src", "probe-runner.ts");
  const fh = await open(logFile, "a");
  const child = spawn("bun", [entry, repoRoot, id], {
    cwd: repoRoot,
    env: { ...process.env, HARNESS_PROBE: "1" },
    detached: true,
    stdio: ["ignore", fh.fd, fh.fd] as ["ignore", number, number],
  });
  child.unref();
  await fh.close();

  await saveTaskMeta(repoRoot, {
    kind: "probe",
    title: `Контрастивная проба: ${taskPrompt.split("\n", 1)[0].slice(0, 80)}`,
    executor: { type: "runtime", id: input.runtimeId },
    model: null,
    pid: child.pid ?? null,
    sessionRuntime: input.runtimeId,
    logFile,
    detail: `вариантов: ${variants.variants.length}; рантайм ${input.runtimeId}`,
  }, id).catch(() => undefined);

  return {
    ok: true,
    id,
    pid: child.pid ?? null,
    detail: `проба запущена (${variants.variants.length} вариантов, ${input.runtimeId}); задача - в Мониторинг → Задачи`,
  };
}

/**
 * Полный цикл пробы в процессе раннера: worktree и замены для каждого варианта,
 * параллельный запуск вариантов, ожидание, контраст провайдера, отчёт, очистка
 * worktree. Рекомендация не применяет изменения: внедрение - оператор (adopt).
 */
export async function runProbeJob(repoRoot: string, id: string): Promise<void> {
  const run = await readProbeRun(repoRoot, id);
  if (!run || run.status !== "running") {
    process.stderr.write("probe: задача не найдена или уже завершена: " + id + "\n");
    process.exit(1);
  }
  let failed = false;
  try {
    const state = await loadConsoleState(repoRoot);
    const judge = await resolveJudgeProvider(repoRoot, state);
    if (typeof judge === "string") throw new Error("аналитик недоступен: " + judge);

    // запуск всех вариантов (отвязанные процессы), затем ожидание и сбор результатов
    const slugs: string[] = [];
    for (let index = 0; index < run.variants.length; index += 1) {
      const variant = run.variants[index];
      const { worktree, slug } = createVariantWorktree(run.workspaceDir, id, index + 1);
      slugs.push(slug);
      await applyOverrides(worktree, variant.fileOverrides);
      const result: ProbeVariantResult = {
        variantId: variant.id,
        label: variant.label,
        worktree,
        branch: slug,
        ok: false,
        error: null,
        output: "",
        usage: null,
        costUsd: null,
        durationMs: 0,
      };
      const startedMs = Date.now();
      try {
        const executed = await executeViaRuntime({
          repoRoot,
          runtimeId: run.runtimeId,
          prompt: buildProbePrompt(run.taskPrompt, variant),
          cwd: worktree,
          timeoutMs: PROBE_TIMEOUT_MS,
          correlation: { workflowRunId: id, workflowStepId: "probe-" + variant.id },
        });
        result.ok = true;
        result.output = executed.output;
        result.usage = executed.usage;
        result.costUsd = executed.costUsd;
      } catch (error) {
        result.ok = false;
        result.error = error instanceof Error ? error.message : String(error);
      }
      result.durationMs = Date.now() - startedMs;
      run.results.push(result);
      await writeProbeRun(repoRoot, run);
    }

    // контрастное сравнение провайдером (без эталона)
    try {
      const judged = await executeProviderRequest({
        preset: judge.preset, providerId: judge.providerId, model: judge.model,
        prompt: buildContrastPrompt(run, run.results), entry: judge.entry, baseUrl: judge.baseUrl,
      });
      if (judged.ok) {
        run.contrast = judged.text;
        run.recommendation = parseRecommendation(judged.text);
      } else {
        run.error = "контрастное сравнение недоступно: " + judged.error;
      }
    } catch (error) {
      run.error = "ошибка контрастного сравнения: " + (error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    failed = true;
    run.error = error instanceof Error ? error.message : String(error);
  }
  run.status = failed ? "failed" : "completed";
  run.finishedAt = new Date().toISOString();
  await writeProbeRun(repoRoot, run);
  // очистка worktree - штатным скриптом; ветки остаются для проверки оператором
  for (let index = 0; index < run.variants.length; index += 1) {
    removeVariantWorktree(repoRoot, worktreeSlug(id, index + 1));
  }
  await finishTaskMeta(repoRoot, id, failed ? "failed" : "completed");
}

/** Сводка пробы для списка; отчёт целиком - GET /api/optimization/probe/<id>. */
export interface ProbeSummary {
  id: string;
  status: ProbeRun["status"];
  startedAt: string;
  finishedAt: string | null;
  runtimeId: string;
  taskPrompt: string;
  variants: Array<{ id: string; label: string; ok: boolean; costUsd: number | null; durationMs: number }>;
  recommendation: ProbeRecommendation | null;
  adoptedVariantId: string | null;
  error: string | null;
}

export function summarizeProbe(run: ProbeRun): ProbeSummary {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    runtimeId: run.runtimeId,
    taskPrompt: run.taskPrompt.split("\n", 1)[0].slice(0, 140),
    variants: run.variants.map((variant) => {
      const result = run.results.find((item) => item.variantId === variant.id);
      return { id: variant.id, label: variant.label, ok: result?.ok ?? false, costUsd: result?.costUsd ?? null, durationMs: result?.durationMs ?? 0 };
    }),
    recommendation: run.recommendation,
    adoptedVariantId: run.adoptedVariantId,
    error: run.error,
  };
}

/** Список сводок проб (новые сверху). */
export async function listProbeSummaries(repoRoot: string): Promise<ProbeSummary[]> {
  const tasksRoot = path.join(repoRoot, ".agents", "console", "tasks");
  const dirs = await readdir(tasksRoot, { withFileTypes: true }).catch(() => []);
  const summaries: ProbeSummary[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const run = await readProbeRun(repoRoot, dir.name);
    if (run) summaries.push(summarizeProbe(run));
  }
  return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Внедрение варианта: промпт для агента на применение замен файлов варианта в
 * основной рабочей папке. Запускается у рантайма; правки .agents/roles|skills
 * проходят через guard-правило structural.agents-mutation (warn) - одобрение
 * оператора в сессии рантайма.
 */
export function buildAdoptPrompt(run: ProbeRun, variant: ProbeVariant): string {
  return [
    `Внедри вариант обвеса "${variant.label}" пробы контрастивного сравнения в основную рабочую папку.`,
    "",
    "## Задача пробы (контекст)",
    run.taskPrompt,
    "",
    "## Замены файлов",
    ...(variant.fileOverrides.length
      ? variant.fileOverrides.flatMap((override) => [
          `### ${override.path}`,
          "Замени файл целиком содержимым блока:",
          "```",
          override.content,
          "```",
        ])
      : ["(замен файлов нет - внедри блок дополнительных инструкций в подходящее место обвеса: AGENTS.md, роль или навык)"]),
    "",
    "## Блок дополнительных инструкций (если замен нет - вставь его в обвес)",
    variant.contextBlock || "(пусто)",
    "",
    "## Требования",
    "- Соблюдай AGENTS.md; структурные изменения .agents/ - только с одобрения пользователя.",
    "- Вноси минимальные правки, не удаляй чужие записи; если замена конфликтует с текущим состоянием файла - объединяй, а не перезаписывай.",
    "- В конце кратко отчитайся, что изменено и как проверить.",
  ].join("\n");
}

/** Отметить внедрение варианта в пробе (после запуска агента внедрения). */
export async function markProbeAdopted(repoRoot: string, id: string, variantId: string): Promise<ProbeRun | null> {
  const run = await readProbeRun(repoRoot, id);
  if (!run) return null;
  if (!run.variants.some((variant) => variant.id === variantId)) return null;
  run.adoptedVariantId = variantId;
  await writeProbeRun(repoRoot, run);
  return run;
}

/** Предложить варианты пробы: провайдер по задаче и принятым урокам библиотеки. */
export async function proposeVariants(
  repoRoot: string,
  state: ConsoleState,
  input: { taskPrompt: string; k?: number },
): Promise<{ ok: true; variants: ProbeVariant[] } | { ok: false; error: string }> {
  const taskPrompt = input.taskPrompt.replace(/\0/g, " ").trim().slice(0, TASK_PROMPT_LIMIT);
  if (!taskPrompt) return { ok: false, error: "текст задачи пуст" };
  const k = Math.min(Math.max(input.k ?? 3, 2), PROBE_MAX_VARIANTS);
  const judge = await resolveJudgeProvider(repoRoot, state);
  if (typeof judge === "string") return { ok: false, error: "провайдер недоступен: " + judge };
  const lessonsBlock = adoptedLessonsBlock(await listLessons(repoRoot));
  const result = await executeProviderRequest({
    preset: judge.preset, providerId: judge.providerId, model: judge.model,
    prompt: buildProposePrompt(taskPrompt, k, lessonsBlock), entry: judge.entry, baseUrl: judge.baseUrl,
  });
  if (!result.ok) return { ok: false, error: "провайдер " + judge.providerId + ": " + result.error };
  const variants = parseProposedVariants(result.text, k);
  if (!variants.length) return { ok: false, error: "модель вернула ответ без пригодных вариантов" };
  return { ok: true, variants };
}
