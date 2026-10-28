import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkflowStore } from "@/core/workflows/storage";
import { defaultState } from "@/core/state";
import {
  computeNextRunAt,
  normalizeRoutineExecutor,
  validateRoutineInput,
  ROUTINE_MAX_CONSECUTIVE_FAILURES,
  ROUTINE_MIN_CRON_GAP_MIN,
  ROUTINE_MIN_INTERVAL_MIN,
} from "@/core/routines";

let root = "";
let store: WorkflowStore;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-routines-"));
  store = new WorkflowStore(root, root);
});

afterAll(async () => {
  store.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("валидация полей рутины", () => {
  test("минимальная валидная рутина", () => {
    const checked = validateRoutineInput({ title: "Сводка", prompt: "Собери сводку", intervalMin: 60 });
    expect(checked).toMatchObject({ title: "Сводка", prompt: "Собери сводку", intervalMin: 60, scheduleType: "interval", cronExpr: null });
  });

  test("пустые поля и интервал ниже минимума отклоняются", () => {
    const checked = validateRoutineInput({ title: " ", prompt: "", intervalMin: ROUTINE_MIN_INTERVAL_MIN - 1 });
    expect("errors" in checked).toBe(true);
    expect((checked as { errors: string[] }).errors.length).toBeGreaterThanOrEqual(3);
  });

  test("интервал по умолчанию - 60 минут", () => {
    const checked = validateRoutineInput({ title: "A", prompt: "B" });
    expect((checked as { intervalMin: number }).intervalMin).toBe(60);
  });
});

describe("cron-расписание рутины", () => {
  test("корректное выражение проходит, неверное и частое отклоняются", () => {
    const ok = validateRoutineInput({ title: "A", prompt: "B", scheduleType: "cron", cronExpr: "0 9 * * 1-5" });
    expect(ok).toMatchObject({ scheduleType: "cron", cronExpr: "0 9 * * 1-5", intervalMin: 0 });

    const noExpr = validateRoutineInput({ title: "A", prompt: "B", scheduleType: "cron", cronExpr: "" });
    expect("errors" in noExpr).toBe(true);

    const broken = validateRoutineInput({ title: "A", prompt: "B", scheduleType: "cron", cronExpr: "99 * * * *" });
    expect("errors" in broken).toBe(true);

    const tooOften = validateRoutineInput({ title: "A", prompt: "B", scheduleType: "cron", cronExpr: `*/${ROUTINE_MIN_CRON_GAP_MIN - 1} * * * *` });
    expect("errors" in tooOften).toBe(true);
    expect((tooOften as { errors: string[] }).errors.join("; ")).toContain("чаще");
  });

  test("computeNextRunAt: интервал - плюс N минут, cron - следующий момент локальной таймзоны", () => {
    const from = new Date(2026, 0, 1, 10, 0);
    expect(computeNextRunAt({ scheduleType: "interval", intervalMin: 90, cronExpr: null }, from))
      .toBe(new Date(2026, 0, 1, 11, 30).toISOString());
    // 10:00 -> ближайшие 12:00 того же дня
    expect(computeNextRunAt({ scheduleType: "cron", intervalMin: 0, cronExpr: "0 12 * * *" }, from))
      .toBe(new Date(2026, 0, 1, 12, 0).toISOString());
    // уже после 12:00 -> 12:00 следующего дня
    expect(computeNextRunAt({ scheduleType: "cron", intervalMin: 0, cronExpr: "0 12 * * *" }, new Date(2026, 0, 1, 13, 0)))
      .toBe(new Date(2026, 0, 2, 12, 0).toISOString());
    // неразбираемое выражение - откладывается на час, не бросает
    const fallback = computeNextRunAt({ scheduleType: "cron", intervalMin: 0, cronExpr: "сломано" }, from);
    expect(fallback).toBe(new Date(2026, 0, 1, 11, 0).toISOString());
  });

  test("хранение: schedule_type и cron_expr проходят roundtrip, интервал по умолчанию - interval", () => {
    const cron = store.createRoutine({ workspaceDir: root, title: "C", prompt: "П", executor: "claude", intervalMin: 0, scheduleType: "cron", cronExpr: "15 8 * * *", enabled: true, nextRunAt: null });
    const read = store.getRoutine(cron.id)!;
    expect(read.scheduleType).toBe("cron");
    expect(read.cronExpr).toBe("15 8 * * *");
    expect(read.intervalMin).toBe(0);
    store.updateRoutine(cron.id, { scheduleType: "interval", intervalMin: 120, cronExpr: null });
    const switched = store.getRoutine(cron.id)!;
    expect(switched.scheduleType).toBe("interval");
    expect(switched.cronExpr).toBeNull();
    expect(switched.intervalMin).toBe(120);
    store.deleteRoutine(cron.id);
    // рутина без явного scheduleType - интервал
    const legacy = store.createRoutine({ workspaceDir: root, title: "L", prompt: "П", executor: "claude", intervalMin: 15, enabled: true, nextRunAt: null });
    expect(store.getRoutine(legacy.id)!.scheduleType).toBe("interval");
    store.deleteRoutine(legacy.id);
  });
});

describe("исполнитель рутины", () => {
  test("provider разворачивается в провайдера по умолчанию", () => {
    const state = defaultState(root);
    expect(normalizeRoutineExecutor(state, "provider")).toBe("provider:" + state.defaultProvider);
  });

  test("рантайм и provider:<id> проходят, мусор отбрасывается", () => {
    const state = defaultState(root);
    expect(normalizeRoutineExecutor(state, "claude")).toBe("claude");
    expect(normalizeRoutineExecutor(state, "provider:ollama")).toBe("provider:ollama");
    expect(normalizeRoutineExecutor(state, "Provider: X")).toBeNull();
    expect(normalizeRoutineExecutor(state, "")).toBeNull();
  });
});

describe("хранилище рутин", () => {
  test("создание, наступление срока и захват расписания", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const routine = store.createRoutine({ workspaceDir: root, title: "Р", prompt: "П", executor: "provider:ollama", intervalMin: 15, enabled: true, nextRunAt: past });
    expect(store.countEnabledRoutines()).toBe(1);
    let due = store.dueRoutines(new Date().toISOString());
    expect(due.map((item) => item.id)).toContain(routine.id);

    store.claimRoutineSchedule(routine.id, new Date().toISOString(), new Date(Date.now() + 15 * 60_000).toISOString());
    due = store.dueRoutines(new Date().toISOString());
    expect(due.map((item) => item.id)).not.toContain(routine.id);

    // выключенная рутина не наступает по расписанию, ручной запрос - наступает
    store.updateRoutine(routine.id, { enabled: false });
    expect(store.dueRoutines(new Date().toISOString())).toHaveLength(0);
    store.requestManualRun(routine.id);
    due = store.dueRoutines(new Date().toISOString());
    expect(due.map((item) => item.id)).toContain(routine.id);
    store.clearManualRun(routine.id);
    expect(store.dueRoutines(new Date().toISOString())).toHaveLength(0);
  });

  test("успех сбрасывает счётчик сбоев, серия сбоев выключает рутину", () => {
    const routine = store.createRoutine({ workspaceDir: root, title: "Р2", prompt: "П", executor: "claude", intervalMin: 15, enabled: true, nextRunAt: null });
    for (let i = 1; i < ROUTINE_MAX_CONSECUTIVE_FAILURES; i += 1) {
      store.recordRoutineResult(routine.id, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
      expect(store.getRoutine(routine.id)!.enabled).toBe(true);
    }
    store.recordRoutineResult(routine.id, false, ROUTINE_MAX_CONSECUTIVE_FAILURES);
    const disabled = store.getRoutine(routine.id)!;
    expect(disabled.enabled).toBe(false);
    expect(disabled.consecutiveFailures).toBe(ROUTINE_MAX_CONSECUTIVE_FAILURES);
    store.recordRoutineResult(routine.id, true, ROUTINE_MAX_CONSECUTIVE_FAILURES);
    expect(store.getRoutine(routine.id)!.consecutiveFailures).toBe(0);
  });

  test("запуски рутины: вставка, финализация, история", () => {
    const routine = store.createRoutine({ workspaceDir: root, title: "Р3", prompt: "П", executor: "claude", intervalMin: 15, enabled: true, nextRunAt: null });
    const runId = store.insertRoutineRun(routine.id, "manual", null, null);
    expect(store.runningRoutineRuns().map((run) => run.id)).toContain(runId);
    store.finishRoutineRun(runId, "failed", "причина");
    const runs = store.listRoutineRuns(routine.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].trigger).toBe("manual");
    expect(runs[0].error).toBe("причина");
    expect(store.runningRoutineRuns()).toHaveLength(0);
    store.deleteRoutine(routine.id);
    expect(store.getRoutine(routine.id)).toBeNull();
    expect(store.listRoutineRuns(routine.id, 10)).toHaveLength(0);
  });
});
