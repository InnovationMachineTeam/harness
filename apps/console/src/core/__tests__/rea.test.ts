import { describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendReaAnalysis,
  buildReaAnalysisSteps,
  buildReaDoctorSteps,
  buildReaEnvBuildSteps,
  findReaAnalysis,
  newReaAnalysisId,
  reaEnvSourcesDir,
  reaOperationById,
  readReaAnalyses,
  updateReaAnalysis,
  REA_OPERATIONS,
  validateReaEnvDir,
  validateReaEnvName,
  validateReaTarget,
} from "@/core/rea";

describe("каталог операций rea", () => {
  test("id уникальны, операции заполнены, группы вкладок корректны", () => {
    const ids = REA_OPERATIONS.map((op) => op.id);
    expect(new Set(ids).size).toBe(REA_OPERATIONS.length);
    for (const op of REA_OPERATIONS) {
      expect(op.args.length).toBeGreaterThan(0);
      expect(op.label).toBeTruthy();
      expect(op.hint).toBeTruthy();
      expect(op.tab === "analyze" || op.tab === "inspectors").toBe(true);
    }
    expect(reaOperationById("analyze")?.tab).toBe("analyze");
    expect(reaOperationById("inspect-sqlite-database")?.tab).toBe("inspectors");
    expect(reaOperationById("no-such-operation")).toBeUndefined();
  });

  test("шаги анализа: формат json, провайдер и evidence-файл", () => {
    const op = reaOperationById("analyze")!;
    const steps = buildReaAnalysisSteps({ operation: op, target: "/tmp/app", evidenceFile: "/e/1.json" });
    expect(steps).toEqual([
      { label: op.label, command: ["rea", "analyze", "/tmp/app", "--format", "json"], outputFile: "/e/1.json", stepId: "analyze" },
    ]);
    const withProvider = buildReaAnalysisSteps({
      operation: op,
      target: "/tmp/app",
      provider: "ghidra",
      evidenceFile: "/e/2.json",
    });
    expect(withProvider[0]!.command).toEqual(["rea", "analyze", "/tmp/app", "--provider", "ghidra", "--format", "json"]);
    const auto = buildReaAnalysisSteps({ operation: op, target: "/tmp/app", provider: "auto", evidenceFile: "/e/3.json" });
    expect(auto[0]!.command).not.toContain("--provider");
  });

  test("шаги сборки среды и диагностики", () => {
    const env = buildReaEnvBuildSteps({
      harPath: "/c.har",
      name: "svc-env",
      sourcesDir: "/r/sources/svc-env",
      evidenceFile: "/e/4.json",
    });
    expect(env[0]!.command).toEqual([
      "rea",
      "environment-build",
      "/c.har",
      "/r/sources/svc-env",
      "--name",
      "svc-env",
      "--format",
      "json",
    ]);
    const doctor = buildReaDoctorSteps();
    expect(doctor.map((step) => step.command)).toEqual([["rea", "doctor", "--json"], ["rea", "mcp", "doctor"]]);
  });

  test("каталог сборки среды - sources/<имя>", () => {
    expect(reaEnvSourcesDir("/repo", "svc-env")).toBe("/repo/sources/svc-env");
  });
});

describe("валидация rea", () => {
  test("цель: абсолютный существующий путь", async () => {
    expect(validateReaTarget("").ok).toBe(false);
    expect(validateReaTarget("relative/path").ok).toBe(false);
    expect(validateReaTarget("/definitely/missing/target").ok).toBe(false);
    const dir = await mkdtemp(path.join(tmpdir(), "rea-test-"));
    try {
      const ok = validateReaTarget(dir);
      expect(ok.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("имя среды: kebab-case", () => {
    expect(validateReaEnvName("svc-env").ok).toBe(true);
    expect(validateReaEnvName("svc").ok).toBe(true);
    expect(validateReaEnvName("").ok).toBe(false);
    expect(validateReaEnvName("My Env").ok).toBe(false);
    expect(validateReaEnvName("кириллица").ok).toBe(false);
    expect(validateReaEnvName("-lead").ok).toBe(false);
    expect(validateReaEnvName("double--dash").ok).toBe(false);
  });

  test("каталог среды: отсутствует или пуст", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rea-test-"));
    try {
      expect(validateReaEnvDir(path.join(root, "absent")).ok).toBe(true);
      const empty = path.join(root, "empty");
      await mkdir(empty);
      expect(validateReaEnvDir(empty).ok).toBe(true);
      const full = path.join(root, "full");
      await mkdir(full);
      await writeFile(path.join(full, "file.txt"), "x");
      expect(validateReaEnvDir(full).ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("id записи - безопасный алфавит", () => {
    expect(newReaAnalysisId()).toMatch(/^[A-Za-z0-9-]+$/);
  });
});

describe("реестр анализов", () => {
  test("append/read/update: последние первыми, мусорные строки пропускаются", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rea-test-"));
    try {
      const id1 = newReaAnalysisId();
      const id2 = newReaAnalysisId();
      await appendReaAnalysis(root, {
        id: id1,
        at: "2026-10-28T10:00:00.000Z",
        action: "analysis",
        operation: "analyze",
        target: "/tmp/app",
        jobId: "j1",
        status: "running",
        exitCode: null,
        evidenceFile: "/e/1.json",
      });
      await appendReaAnalysis(root, {
        id: id2,
        at: "2026-10-28T11:00:00.000Z",
        action: "environment",
        operation: "environment-build",
        target: "/tmp/capture.har",
        name: "svc-env",
        sourcesDir: path.join(root, "sources", "svc-env"),
        jobId: "j2",
        status: "running",
        exitCode: null,
        evidenceFile: "/e/2.json",
      });
      appendFileSync(path.join(root, ".agents", "console", "rea", "analyses.jsonl"), "мусорная строка\n");
      const all = await readReaAnalyses(root);
      expect(all.map((entry) => entry.id)).toEqual([id2, id1]);
      await updateReaAnalysis(root, id1, { status: "ok", exitCode: 0 });
      const found = await findReaAnalysis(root, id1);
      expect(found?.status).toBe("ok");
      expect(found?.exitCode).toBe(0);
      expect(await findReaAnalysis(root, "missing")).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
