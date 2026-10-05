import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nestedWorkspaceExcluder, wikiBuildPlan } from "@/core/memory";
import { graphifyBackendArg, graphifyLlmConfig, graphifyLlmEnv } from "@/core/openwikiLlm";
import {
  finalizeTaskStatuses,
  finishTaskMeta,
  newTaskId,
  readTaskMetas,
  saveTaskMeta,
  STALE_RUNNING_MS,
  taskTitle,
} from "@/core/tasks";
import { fsSignals } from "@/lib/signals/fs";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tasks-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("реестр задач", () => {
  test("мета записывается и читается (новые сверху)", async () => {
    const id1 = await saveTaskMeta(root, {
      kind: "openwiki-build",
      title: "Сборка вики OpenWiki (init)",
      executor: { type: "tool", id: "openwiki" },
      model: "glm-5.3-flash:cloud",
      pid: 999_999_999,
      sessionRuntime: null,
      logFile: null,
      detail: "/tmp/wiki",
    });
    const id2 = await saveTaskMeta(root, {
      kind: "prompt",
      title: taskTitle("почини сборку\nвторой строкой"),
      executor: { type: "runtime", id: "claude" },
      model: null,
      pid: 999_999_998,
      sessionRuntime: "claude",
      logFile: null,
      detail: null,
    });
    expect(id2).not.toBe(id1);
    const metas = await readTaskMetas(root);
    const mine = metas.filter((m) => m.id === id1 || m.id === id2);
    expect(mine.length).toBe(2);
    expect(mine[0].id).toBe(id2);
    expect(mine[0].status).toBe("running");
    expect(mine[1].detail).toBe("/tmp/wiki");
  });

  test("процесс мёртв, лог чист - задача завершена", async () => {
    const logFile = join(root, "clean.log");
    await writeFile(logFile, "сборка запущена\n", "utf8");
    const id = await saveTaskMeta(root, {
      kind: "graphify-build",
      title: "Сборка графа Graphify (update)",
      executor: { type: "tool", id: "graphify" },
      model: null,
      pid: 999_999_997,
      sessionRuntime: null,
      logFile,
      detail: null,
    });
    const metas = await finalizeTaskStatuses(root);
    const meta = metas.find((m) => m.id === id)!;
    expect(meta.status).toBe("completed");
    expect(meta.finishedAt).toBeTruthy();
  });

  test("ошибка в логе до старта задачи не читается (offset), после старта - failed", async () => {
    const logFile = join(root, "graphify.log");
    await writeFile(logFile, "error: старая попытка\n", "utf8");
    const idOld = await saveTaskMeta(root, {
      kind: "graphify-build",
      title: "старая ошибка до старта не считается",
      executor: { type: "tool", id: "graphify" },
      model: null,
      pid: 999_999_996,
      sessionRuntime: null,
      logFile,
      detail: null,
    });
    let metas = await finalizeTaskStatuses(root);
    expect(metas.find((m) => m.id === idOld)!.status).toBe("completed");

    // новая задача на том же логе стартует с текущего размера; дописанная ошибка - её
    const idNew = await saveTaskMeta(root, {
      kind: "graphify-build",
      title: "новая ошибка после старта",
      executor: { type: "tool", id: "graphify" },
      model: null,
      pid: 999_999_995,
      sessionRuntime: null,
      logFile,
      detail: null,
    });
    await appendFile(logFile, "error: no LLM API key found\n", "utf8");
    metas = await finalizeTaskStatuses(root);
    expect(metas.find((m) => m.id === idNew)!.status).toBe("failed");
  });

  test("промт с фейлом запуска - failed", async () => {
    const logFile = join(root, "prompt.log");
    const id = await saveTaskMeta(root, {
      kind: "prompt",
      title: "промт",
      executor: { type: "runtime", id: "claude" },
      model: null,
      pid: 999_999_994,
      sessionRuntime: "claude",
      logFile,
      detail: null,
    });
    await writeFile(logFile, "Failed to authenticate: run `claude` interactively\n", "utf8");
    const metas = await finalizeTaskStatuses(root);
    expect(metas.find((m) => m.id === id)!.status).toBe("failed");
  });

  test("живой процесс остаётся running", async () => {
    const child = spawn("sleep", ["5"]);
    const logFile = join(root, "alive.log");
    const id = await saveTaskMeta(root, {
      kind: "prompt",
      title: "живая задача",
      executor: { type: "runtime", id: "zcode" },
      model: null,
      pid: child.pid ?? null,
      sessionRuntime: "zcode",
      logFile,
      detail: null,
    });
    const metas = await finalizeTaskStatuses(root);
    expect(metas.find((m) => m.id === id)!.status).toBe("running");
    child.kill("SIGKILL");
  });

  test("provider-задача (pid null) старше потолка - interrupted; финализация повтором не меняется", async () => {
    const id = newTaskId();
    const staleStartedAt = new Date(Date.now() - STALE_RUNNING_MS - 60_000).toISOString();
    await mkdir(join(root, ".agents", "console", "tasks"), { recursive: true });
    await writeFile(
      join(root, ".agents", "console", "tasks", `${id}.json`),
      JSON.stringify({
        id,
        kind: "prompt",
        title: "запрос провайдеру",
        executor: { type: "provider", id: "ollama" },
        model: "glm-5.3-flash:cloud",
        pid: null,
        status: "running",
        startedAt: staleStartedAt,
        finishedAt: null,
        sessionRuntime: null,
        logFile: null,
        logStartOffset: 0,
        detail: null,
      }),
      "utf8",
    );
    let metas = await finalizeTaskStatuses(root);
    expect(metas.find((m) => m.id === id)!.status).toBe("interrupted");
    // повторная финализация не перезаписывает завершённую задачу
    await finishTaskMeta(root, id, "completed");
    metas = await readTaskMetas(root);
    expect(metas.find((m) => m.id === id)!.status).toBe("interrupted");
  });
});

describe("план сборки OpenWiki (resume прерванной сборки)", () => {
  test("обычный запуск: язык ru, режим по index.md", () => {
    const fresh = wikiBuildPlan({ indexMdExists: false, interrupted: null, resumableState: false });
    expect(fresh.mode).toBe("init");
    expect(fresh.language).toBe("ru");
    expect(fresh.resumeNote).toBe("");
    const update = wikiBuildPlan({ indexMdExists: true, interrupted: null, resumableState: false });
    expect(update.mode).toBe("update");
  });

  test("прерванная сборка в en: resume в en с пояснением", () => {
    const plan = wikiBuildPlan({
      indexMdExists: false,
      interrupted: { status: "interrupted", command: "init", language: "en" },
      resumableState: true,
    });
    expect(plan.mode).toBe("init");
    expect(plan.language).toBe("en");
    expect(plan.resumeNote).toContain("en");
  });

  test("прерванная сборка в ru: обычный resume на ru", () => {
    const plan = wikiBuildPlan({
      indexMdExists: false,
      interrupted: { status: "interrupted", command: "update", language: "ru" },
      resumableState: true,
    });
    expect(plan.mode).toBe("update");
    expect(plan.language).toBe("ru");
    expect(plan.resumeNote).toBe("");
  });

  test("статус interrupted без .run.json - состояние не считается resumable", () => {
    const plan = wikiBuildPlan({
      indexMdExists: false,
      interrupted: { status: "interrupted", command: "init", language: "en" },
      resumableState: false,
    });
    expect(plan.language).toBe("ru");
    expect(plan.resumeNote).toBe("");
  });
});

describe("graphify: бэкенд и env из пресета", () => {
  const state = (preset: string, apiKey: string) =>
    ({ graphifyLlm: { preset, apiKey } }) as never;

  test("--backend берётся из пресета; auto и claude-cli для extract не задаются", () => {
    expect(graphifyBackendArg(graphifyLlmConfig(state("ollama", "x")))).toBe("ollama");
    expect(graphifyBackendArg(graphifyLlmConfig(state("gemini", "x")))).toBe("gemini");
    expect(graphifyBackendArg(graphifyLlmConfig(state("auto", "")))).toBeNull();
    expect(graphifyBackendArg(graphifyLlmConfig(state("claude-cli", "")))).toBeNull();
  });

  test("ключ пресета передаётся своей env-переменной", () => {
    expect(graphifyLlmEnv(graphifyLlmConfig(state("ollama", "k")))).toEqual({ OLLAMA_API_KEY: "k" });
    expect(graphifyLlmEnv(graphifyLlmConfig(state("auto", "")))).toEqual({});
  });
});

describe("вложенные рабочие папки в дереве Docs", () => {
  test("excluder отсекает поддерево вложенной папки, чужие файлы остаются", async () => {
    const repo = await mkdtemp(join(tmpdir(), "nested-"));
    try {
      await mkdir(join(repo, "docs"), { recursive: true });
      await mkdir(join(repo, "sources", "proj"), { recursive: true });
      await writeFile(join(repo, "README.md"), "# root\n", "utf8");
      await writeFile(join(repo, "docs", "guide.md"), "# docs\n", "utf8");
      await writeFile(join(repo, "sources", "proj", "note.md"), "# src\n", "utf8");
      const exclude = nestedWorkspaceExcluder(repo, [repo, join(repo, "docs"), join(repo, "sources")]);
      const files = await fsSignals.collectFiles(repo, { match: (n) => n.endsWith(".md"), exclude });
      const rels = files.map((f) => f.relPath).sort();
      // docs/ и sources/ - самостоятельные рабочие папки: в дереве корня скрыты
      expect(rels).toEqual(["README.md"]);
      // без вложенных папок предикат не нужен
      expect(nestedWorkspaceExcluder(repo, [repo])).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
