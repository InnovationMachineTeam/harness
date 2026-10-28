import path from "node:path";
import { CronExpressionParser } from "cron-parser";
import { ADAPTERS } from "../runtimes";
import { runAgentLoop } from "./agentLoop";
import { processAlive } from "./memory";
import { isActiveProvider, parseTaskProviderId, providerBaseUrlError, providerPresetById } from "./providers";
import { readProviderEntry } from "./providerSettings";
import { launchPromptRun } from "./prompts";
import { loadConsoleState, resolveDefaultProvider, resolveTaskRuntime, type ConsoleState } from "./state";
import { finishTaskMeta, logHasFailurePatterns, saveTaskMeta } from "./tasks";
import { WorkflowStore, type RoutineRecord } from "./workflows/storage";

/**
 * Рутины: периодические запуски промта по расписанию - интервалу (модель
 * OpenBot: от 15 минут) или cron-выражению (локальная таймзона, минимум 5
 * минут между срабатываниями). Лимит включённых и автоотключение после серии
 * сбоев - общие. Определения и история живут в workspace-базе workflow;
 * планировщик - тик в worker-loop (аренда воркера исключает второго
 * исполнителя), запуск - launchPromptRun для рантайма или агентный цикл для
 * провайдера. Все запуски инициирует только воркер: маршрут /api/routines
 * ставит запрос (manual_run_at), но не исполняет - соединение БД маршрута
 * закрывается до конца фонового прогона.
 */

/** Минимальный интервал рутины, минуты (модель OpenBot). */
export const ROUTINE_MIN_INTERVAL_MIN = 15;
/** Максимальный интервал рутины, минуты (неделя). */
export const ROUTINE_MAX_INTERVAL_MIN = 10_080;
/** Минимальный разрыв между срабатываниями cron-рутины, минуты. */
export const ROUTINE_MIN_CRON_GAP_MIN = 5;
/** Потолок одновременно включённых рутин. */
export const ROUTINE_MAX_ENABLED = 20;
/** Серия сбоев, после которой рутина выключается. */
export const ROUTINE_MAX_CONSECUTIVE_FAILURES = 10;
/** Бюджет провайдерского прогона рутины. */
export const ROUTINE_TIMEOUT_MS = 15 * 60_000;
/** Период тика планировщика в воркере. */
export const ROUTINE_TICK_MS = 5_000;

export type RoutineScheduleType = "interval" | "cron";

/** Исполнитель рутины по умолчанию: рантайм для промтов или провайдер по умолчанию. */
export function defaultRoutineExecutor(state: ConsoleState): string {
  return resolveTaskRuntime(state, "promptExecution") ?? `provider:${resolveDefaultProvider(state)}`;
}

/** Нормализация исполнителя: "provider" -> "provider:<default>"; некорректное значение - null. */
export function normalizeRoutineExecutor(state: ConsoleState, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (trimmed === "provider") return `provider:${resolveDefaultProvider(state)}`;
  if (trimmed.startsWith("provider:")) {
    const id = trimmed.slice("provider:".length);
    return /^[a-z0-9][a-z0-9-]*$/.test(id) ? trimmed : null;
  }
  return /^[a-z0-9][a-z0-9-]*$/.test(trimmed) ? trimmed : null;
}

/** Разбор cron-выражения рутины; бросает ошибку с текстом для ответа 400. */
export function parseRoutineCron(expr: string, from = new Date()): ReturnType<typeof CronExpressionParser.parse> {
  return CronExpressionParser.parse(expr, { currentDate: from });
}

/**
 * Валидация полей рутины (создание и правка); возвращает ошибки для ответа 400.
 * Расписание: interval (intervalMin 15-10080) или cron (выражение парсится,
 * разрыв между срабатываниями не меньше ROUTINE_MIN_CRON_GAP_MIN минут).
 */
export function validateRoutineInput(input: {
  title?: unknown;
  prompt?: unknown;
  intervalMin?: unknown;
  scheduleType?: unknown;
  cronExpr?: unknown;
}): { title: string; prompt: string; intervalMin: number; scheduleType: RoutineScheduleType; cronExpr: string | null } | { errors: string[] } {
  const errors: string[] = [];
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!title) errors.push("заголовок обязателен");
  if (title.length > 200) errors.push("заголовок длиннее 200 символов");
  if (!prompt) errors.push("промт обязателен");
  if (prompt.length > 32_000) errors.push("промт длиннее 32000 символов");
  const scheduleType: RoutineScheduleType = input.scheduleType === "cron" ? "cron" : "interval";
  const cronExpr = typeof input.cronExpr === "string" ? input.cronExpr.trim() : "";
  let intervalMin = typeof input.intervalMin === "number" ? input.intervalMin : Number(input.intervalMin ?? 60);
  if (scheduleType === "interval") {
    if (!Number.isInteger(intervalMin) || intervalMin < ROUTINE_MIN_INTERVAL_MIN || intervalMin > ROUTINE_MAX_INTERVAL_MIN) {
      errors.push(`интервал - целое число минут от ${ROUTINE_MIN_INTERVAL_MIN} до ${ROUTINE_MAX_INTERVAL_MIN}`);
    }
  } else {
    if (!cronExpr) errors.push("cron-выражение обязательно для расписания cron");
    if (cronExpr.length > 120) errors.push("cron-выражение длиннее 120 символов");
    if (cronExpr && cronExpr.length <= 120) {
      try {
        const interval = parseRoutineCron(cronExpr);
        const first = interval.next().toDate();
        const second = interval.next().toDate();
        if (second.getTime() - first.getTime() < ROUTINE_MIN_CRON_GAP_MIN * 60_000) {
          errors.push(`срабатывания cron-выражения чаще ${ROUTINE_MIN_CRON_GAP_MIN} минут не допускаются`);
        }
      } catch (error) {
        errors.push(`cron-выражение не разобрано: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // колонка interval_min NOT NULL - у cron-рутин поле не используется
    intervalMin = 0;
  }
  if (errors.length) return { errors };
  return { title, prompt, intervalMin, scheduleType, cronExpr: scheduleType === "cron" ? cronExpr : null };
}

/** Следующий момент запуска рутины от указанного времени (ISO): интервал или cron. */
export function computeNextRunAt(routine: Pick<RoutineRecord, "scheduleType" | "intervalMin" | "cronExpr">, from = new Date()): string {
  if (routine.scheduleType === "cron" && routine.cronExpr) {
    try {
      return parseRoutineCron(routine.cronExpr, from).next().toDate().toISOString();
    } catch {
      // выражение перестало разбираться (правка файла базы) - откладываем на час
      return new Date(from.getTime() + 60 * 60_000).toISOString();
    }
  }
  return new Date(from.getTime() + routine.intervalMin * 60_000).toISOString();
}

/** Запуск рутины: создаёт запись routine_runs и стартует исполнителя. Вызывает только воркер. */
export async function startRoutineRun(opts: {
  repoRoot: string;
  state: ConsoleState;
  store: WorkflowStore;
  routine: RoutineRecord;
  trigger: "schedule" | "manual";
}): Promise<{ runId: string; ok: boolean; detail: string }> {
  const { repoRoot, state, store, routine, trigger } = opts;
  const failRun = (detail: string) => {
    const runId = store.insertRoutineRun(routine.id, trigger, null, null);
    store.finishRoutineRun(runId, "failed", detail);
    store.recordRoutineResult(routine.id, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
    return { runId, ok: false, detail };
  };

  const providerId = parseTaskProviderId(routine.executor);
  if (providerId !== null) {
    const preset = providerPresetById(providerId);
    const entry = preset ? await readProviderEntry(repoRoot, preset, state.providers.entries[providerId] ?? null) : null;
    if (!preset || !entry || !isActiveProvider(preset, entry)) {
      return failRun(`провайдер ${providerId} не активен - заполните поля на вкладке "Провайдеры"`);
    }
    const baseUrlError = providerBaseUrlError(entry.baseUrl, preset.kind);
    if (baseUrlError) return failRun(baseUrlError);
    const model = entry.models.standard?.trim();
    if (!model) return failRun(`у провайдера ${providerId} не задана модель tier standard`);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(repoRoot, ".agents", "console", "runs", `${stamp}-routine-${providerId}.log`);
    const taskId = await saveTaskMeta(repoRoot, {
      kind: "routine",
      title: `Рутина: ${routine.title}`,
      executor: { type: "provider", id: providerId },
      model,
      pid: null,
      sessionRuntime: null,
      logFile,
      detail: routine.workspaceDir,
    }).catch(() => null);
    const runId = store.insertRoutineRun(routine.id, trigger, null, logFile);
    void runAgentLoop({
      repoRoot,
      providerId,
      preset,
      entry,
      model,
      prompt: routine.prompt,
      toolCwd: routine.workspaceDir,
      timeoutMs: ROUTINE_TIMEOUT_MS,
      maxRounds: 24,
      logFile,
    })
      .then(async (result) => {
        const ok = result.ok && Boolean(result.text.trim());
        store.finishRoutineRun(runId, ok ? "completed" : "failed", ok ? null : (result.error ?? "агентный цикл завершился без результата"));
        store.recordRoutineResult(routine.id, ok, ROUTINE_MAX_CONSECUTIVE_FAILURES);
        if (taskId) await finishTaskMeta(repoRoot, taskId, ok ? "completed" : "failed").catch(() => undefined);
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.finishRoutineRun(runId, "failed", message);
        store.recordRoutineResult(routine.id, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
        if (taskId) await finishTaskMeta(repoRoot, taskId, "failed").catch(() => undefined);
      });
    return { runId, ok: true, detail: `рутина запущена через провайдера ${providerId}` };
  }

  const adapter = ADAPTERS[routine.executor];
  if (!adapter) {
    return failRun(`исполнитель не найден: ${routine.executor}`);
  }
  const result = await launchPromptRun({
    repoRoot,
    adapter,
    runtimeId: routine.executor,
    prompt: routine.prompt,
    cwd: routine.workspaceDir,
    taskKind: "routine",
    taskTitle: `Рутина: ${routine.title}`,
  });
  const runId = store.insertRoutineRun(routine.id, trigger, result.pid, result.logFile || null);
  if (!result.ok) {
    store.finishRoutineRun(runId, "failed", result.detail);
    store.recordRoutineResult(routine.id, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
  }
  return { runId, ok: result.ok, detail: result.detail };
}

/**
 * Финализация висящих запусков: рантайм-процесс с pid закончился - статус по
 * паттернам ошибок лога; провайдерский прогон без финализации дольше бюджета -
 * ошибка (воркер перезапущен посреди цикла).
 */
export async function finalizeRoutineRuns(repoRoot: string, store: WorkflowStore): Promise<void> {
  for (const run of store.runningRoutineRuns()) {
    if (run.pid === null) {
      const ageMs = Date.now() - Date.parse(run.startedAt);
      if (Number.isFinite(ageMs) && ageMs > ROUTINE_TIMEOUT_MS + 5 * 60_000) {
        store.finishRoutineRun(run.id, "failed", "провайдерский прогон не финализирован (воркер перезапущен)");
        store.recordRoutineResult(run.routineId, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
      }
      continue;
    }
    if (processAlive(run.pid)) continue;
    const failed = await logHasFailurePatterns(run.logFile, 0, "routine");
    store.finishRoutineRun(run.id, failed ? "failed" : "completed", failed ? "лог запуска содержит ошибки" : null);
    store.recordRoutineResult(run.routineId, failed, ROUTINE_MAX_CONSECUTIVE_FAILURES);
  }
}

/**
 * Тик планировщика (вызывается воркером раз в ROUTINE_TICK_MS на каждую
 * workspace-базу с арендой): финализирует висящие запуски и стартует рутины,
 * у которых наступил срок или стоит запрос ручного запуска.
 */
export async function tickRoutines(repoRoot: string, store: WorkflowStore, state?: ConsoleState): Promise<void> {
  const consoleState = state ?? await loadConsoleState(repoRoot);
  await finalizeRoutineRuns(repoRoot, store);
  const nowIso = new Date().toISOString();
  for (const routine of store.dueRoutines(nowIso)) {
    // Ручной запрос ("запустить сейчас") снимается первым: расписание не сдвигается.
    const manual = await hasManualRequest(store, routine.id);
    let trigger: "schedule" | "manual" = "schedule";
    if (manual) {
      store.clearManualRun(routine.id);
      trigger = "manual";
    } else {
      store.claimRoutineSchedule(routine.id, nowIso, computeNextRunAt(routine));
    }
    try {
      const started = await startRoutineRun({ repoRoot, state: consoleState, store, routine, trigger });
      if (!started.ok) process.stderr.write(`[worker] рутина ${routine.id} не запущена: ${started.detail}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[worker] рутина ${routine.id} отклонена: ${message}\n`);
      store.recordRoutineResult(routine.id, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
    }
  }
}

function hasManualRequest(store: WorkflowStore, routineId: string): boolean {
  // Запрос ручного запуска определяется по колонке manual_run_at записи рутины.
  const row = store.db.prepare("SELECT manual_run_at FROM routines WHERE id = ?").get(routineId) as { manual_run_at?: string | null } | undefined;
  return Boolean(row?.manual_run_at);
}
