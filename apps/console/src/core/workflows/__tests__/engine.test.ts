import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeWorkflowCommand, parseOperatorQuestions, parseVerdict, waitForProcess } from "../engine";
import { processAlive } from "../../memory";
import { workflowSchema } from "../schema";
import { WorkflowStore } from "../storage";

/** Минимальный workflow для тестов команд: один шаг без контролов. */
const workflow = workflowSchema.parse({
  apiVersion: "harness/v1",
  kind: "Workflow",
  id: "engine-test",
  title: "Engine test",
  nodes: [{
    id: "a", title: "A", phase: "one", description: "", dependsOn: [],
    roles: ["worker-role"],
    runtime: { candidates: ["codex"], tier: "standard" as const, effort: "medium" as const },
    execution: { prompt: "сделай", confirmPlan: false, producesTasks: false },
    inputs: [], outputs: ["a"], timeoutMs: 900_000,
    retry: { maxAttempts: 1 }, resources: { workspace: "read" as const },
  }],
});

describe("parseVerdict", () => {
  test("блок ```json с полями вердикта", () => {
    const verdict = parseVerdict('текст\n```json\n{"verdict":"pass","category":"tests","findings":["a"],"comments":"b"}\n```\n');
    expect(verdict.verdict).toBe("pass");
    expect(verdict.category).toBe("tests");
  });

  test("простая ```-ограда с вложенными объектами findings и criteria", () => {
    const output = "Отчёт ревью\n```\n{\"verdict\":\"fail\",\"category\":\"review\",\"findings\":[{\"severity\":\"High\",\"risk\":\"риск\"}],\"criteria\":[{\"criterion\":\"объём рынка\",\"status\":\"fail\",\"note\":\"нет данных\"}],\"comments\":\"коммент\"}\n```\n";
    const verdict = parseVerdict(output);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.findings).toEqual(['{"severity":"High","risk":"риск"}']);    expect(verdict.criteria).toHaveLength(1);
    expect(verdict.criteria[0].criterion).toBe("объём рынка");
  });

  test("сырой JSON без ограды - сбалансированный объект вокруг вердикта", () => {
    const verdict = parseVerdict('Итог: {"verdict": "pass", "criteria": [{"criterion":"a","status":"pass"}]} конец');
    expect(verdict.verdict).toBe("pass");
    expect(verdict.criteria).toHaveLength(1);
  });

  test("последний из нескольких блоков выигрывает", () => {
    const output = '```json\n{"verdict":"fail"}\n```\nпромежуток\n```json\n{"verdict":"pass"}\n```';
    expect(parseVerdict(output).verdict).toBe("pass");
  });

  test("без вердикта - ошибка", () => {
    expect(() => parseVerdict("обычный текст без json")).toThrow("машинный вердикт");
  });
});

describe("parseOperatorQuestions", () => {
  test("оставляет только полные пары вопрос-ответ", () => {
    const qa = parseOperatorQuestions([
      { question: "Какой сегмент приоритетен?", answer: "SMB" },
      { question: "Без ответа", answer: "" },
      { question: "", answer: "без вопроса" },
      null,
      "мусор",
    ]);
    expect(qa).toEqual([{ question: "Какой сегмент приоритетен?", answer: "SMB" }]);
  });

  test("не-массив даёт пустой список", () => {
    expect(parseOperatorQuestions(undefined)).toEqual([]);
    expect(parseOperatorQuestions("мусор")).toEqual([]);
  });
});

describe("waitForProcess", () => {
  test("запуск без pid - попытка недостоверна, failover", async () => {
    await expect(waitForProcess(null, { timeoutMs: 1000 })).rejects.toThrow("без идентификатора");
  });

  test("отмена прогона останавливает живой процесс", async () => {
    const child = spawn("sleep", ["30"]);
    try {
      expect(child.pid).toBeTruthy();
      await expect(waitForProcess(child.pid as number, { timeoutMs: 60_000, isCancelled: () => true })).rejects.toThrow("отменён оператором");
      // Процесс получил сигнал завершения в течение льготного окна.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(processAlive(child.pid as number)).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("без отмены и таймаута ожидание завершается вместе с процессом", async () => {
    const child = spawn("true");
    await expect(waitForProcess(child.pid as number, { timeoutMs: 60_000 })).resolves.toBeUndefined();
  });

  test("heartbeat ожидания срабатывает с заданным интервалом", async () => {
    const child = spawn("sleep", ["1"]);
    const beats: number[] = [];
    try {
      await waitForProcess(child.pid as number, { timeoutMs: 60_000, onWait: (elapsedMs) => beats.push(elapsedMs), heartbeatMs: 200 });
    } finally {
      child.kill("SIGKILL");
    }
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0]).toBeGreaterThanOrEqual(150);
  }, 10_000);
});

describe("executeWorkflowCommand: отмена", () => {
  test("cancel делает статус терминальным, отложенная команда не возобновляет прогон", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "engine-cancel-"));
    const store = new WorkflowStore(root, root);
    try {
      const run = store.createRun({ workspaceDir: root, workflow, title: "Отмена" });
      await executeWorkflowCommand(root, store, run.id, { type: "cancel", payload: { reason: "тест" } });
      expect(store.getRun(run.id)?.status).toBe("cancelled");
      await executeWorkflowCommand(root, store, run.id, { type: "retry", payload: { reason: "тест" } });
      expect(store.getRun(run.id)?.status).toBe("cancelled");
      const suppressed = store.listEvents(run.id).find((event) => event.type === "run.cancelled" && event.payload.suppressed);
      expect(suppressed?.payload.suppressed).toBe("retry");
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
