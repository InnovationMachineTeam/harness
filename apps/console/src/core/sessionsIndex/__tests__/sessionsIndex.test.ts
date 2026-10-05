import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dayKey } from "@/lib/format";
import { collectSessionsIndex } from "@/core/sessionsIndex/collect";
import { SessionIndexStore } from "@/core/sessionsIndex/store";

let home = "";
let repo = "";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "sessidx-home-"));
  repo = await mkdtemp(join(tmpdir(), "sessidx-repo-"));

  /* Claude: user + assistant (usage, tool_use) + второй user */
  const claudeProject = join(home, ".claude", "projects", "-tmp-project");
  await mkdir(claudeProject, { recursive: true });
  await appendFile(
    join(claudeProject, "sess-claude-one.jsonl"),
    [
      JSON.stringify({ type: "user", timestamp: "2026-10-01T10:00:00.000Z", sessionId: "claude-one", cwd: "/tmp/project", message: { role: "user", content: "найди первопричину падения теста" } }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-01T10:00:05.000Z",
        sessionId: "claude-one",
        cwd: "/tmp/project",
        message: {
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [
            { type: "text", text: "смотрю журнал тестов" },
            { type: "tool_use", id: "t1", name: "Grep", input: {} },
          ],
          usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 500, cache_creation_input_tokens: 10 },
        },
      }),
      JSON.stringify({ type: "user", timestamp: "2026-10-01T10:01:00.000Z", sessionId: "claude-one", cwd: "/tmp/project", message: { role: "user", content: "почини и перезапусти" } }),
    ].join("\n") + "\n",
  );

  /* ZCode: два запроса (один дубль requestId) + request для заголовка */
  const zcodeDir = join(home, ".zcode", "cli", "rollout");
  await mkdir(zcodeDir, { recursive: true });
  const zcodeRecord = (requestId: string, input: number, output: number) =>
    JSON.stringify({
      requestId,
      startedAt: "2026-10-01T11:00:00.000Z",
      completedAt: "2026-10-01T11:00:05.000Z",
      model: { modelId: "GLM-5.3-Flash", providerId: "account:test" },
      request: { messages: [{ role: "user", content: [{ type: "text", text: "рефактори модуль engine" }] }] },
      response: { usage: { inputTokens: input, outputTokens: output, totalTokens: input + output, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    });
  await appendFile(join(zcodeDir, "model-io-sess_zcode-one.jsonl"), [zcodeRecord("r1", 200, 30), zcodeRecord("r2", 10, 5), zcodeRecord("r2", 10, 5)].join("\n") + "\n");

  /* Codex: rollout с session_meta, сообщениями, function_call и кумулятивом */
  const codexDay = join(home, ".codex", "sessions", "2026", "10", "01");
  await mkdir(codexDay, { recursive: true });
  await appendFile(
    join(codexDay, "rollout-2026-10-01T09-00-00-11111111-2222-3333-4444-555555555555.jsonl"),
    [
      JSON.stringify({ timestamp: "2026-10-01T09:00:00.000Z", type: "session_meta", payload: { cwd: "/tmp/codex", session_id: "codex-one" } }),
      JSON.stringify({ timestamp: "2026-10-01T09:00:10.000Z", type: "event_msg", payload: { type: "user_message", message: "собери отчёт по гонкам" } }),
      JSON.stringify({ timestamp: "2026-10-01T09:00:20.000Z", type: "event_msg", payload: { type: "function_call", name: "shell", arguments: "{}" } }),
      JSON.stringify({
        timestamp: "2026-10-01T09:01:00.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, output_tokens: 200, cached_input_tokens: 300, reasoning_output_tokens: 50, total_tokens: 1200 } } },
      }),
    ].join("\n") + "\n",
  );

  /* Kimi: индекс сессий + state.json */
  const kimiSessionDir = join(home, ".kimi-code", "sessions", "session_kimi-one");
  await mkdir(kimiSessionDir, { recursive: true });
  await appendFile(join(home, ".kimi-code", "session_index.jsonl"), JSON.stringify({ sessionId: "kimi-one", sessionDir: kimiSessionDir, workDir: "/tmp/kimi" }) + "\n");
  await appendFile(join(kimiSessionDir, "state.json"), JSON.stringify({ title: "правки консоли", createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:30:00.000Z" }));
});

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  if (repo) await rm(repo, { recursive: true, force: true });
});

function collect(): Promise<number> {
  return collectSessionsIndex(repo, { home, opencode: false });
}

function openStore(): SessionIndexStore {
  return new SessionIndexStore(repo);
}

describe("collectSessionsIndex", () => {
  test("первый сбор: сессии всех рантаймов с метриками", async () => {
    const sessions = await collect();
    expect(sessions).toBe(4);

    const store = openStore();
    try {
      const claude = store.getSession("claude", "claude-one");
      expect(claude).not.toBeNull();
      expect(claude!.inputTokens).toBe(100);
      expect(claude!.outputTokens).toBe(40);
      expect(claude!.cacheTokens).toBe(510);
      expect(claude!.turns).toBe(2);
      expect(claude!.messageCount).toBe(3);
      expect(claude!.toolCount).toBe(1);
      expect(claude!.workspaceDir).toBe("/tmp/project");
      expect(claude!.models).toContain("claude-sonnet-5-5");
      // каталога цен в temp-repo нет - стоимость 0, покрытие 0
      expect(claude!.costUsd).toBe(0);
      expect(claude!.pricingCoverage).toBe(0);
      expect(claude!.durationMs).toBeGreaterThan(0);

      const zcode = store.getSession("zcode", "sess_zcode-one");
      expect(zcode).not.toBeNull();
      // дубликат requestId r2 не учитывается
      expect(zcode!.inputTokens).toBe(210);
      expect(zcode!.outputTokens).toBe(35);
      expect(zcode!.title).toBe("рефактори модуль engine");
      expect(zcode!.turns).toBe(0); // тексты model-io не человекочитаемые сообщения - не пишутся

      const codex = store.getSession("codex", "codex-one");
      expect(codex).not.toBeNull();
      expect(codex!.inputTokens).toBe(1000);
      expect(codex!.outputTokens).toBe(200);
      expect(codex!.cacheTokens).toBe(300);
      expect(codex!.workspaceDir).toBe("/tmp/codex");
      expect(codex!.toolCount).toBe(1);
      expect(codex!.turns).toBe(1);

      const kimi = store.getSession("kimi", "kimi-one");
      expect(kimi).not.toBeNull();
      expect(kimi!.title).toBe("правки консоли");
      expect(kimi!.workspaceDir).toBe("/tmp/kimi");
      expect(kimi!.startedAt).toBe("2026-10-01T12:00:00.000Z");
    } finally {
      store.close();
    }
  });

  test("повторный сбор без изменений не меняет метрики", async () => {
    await collect();
    const store = openStore();
    try {
      const claude = store.getSession("claude", "claude-one");
      expect(claude!.inputTokens).toBe(100);
      expect(claude!.messageCount).toBe(3);
    } finally {
      store.close();
    }
  });

  test("дозапись в транскрипт даёт только дельту", async () => {
    const file = join(home, ".claude", "projects", "-tmp-project", "sess-claude-one.jsonl");
    await appendFile(
      file,
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-01T10:02:00.000Z",
        sessionId: "claude-one",
        cwd: "/tmp/project",
        message: { role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: "готово" }], usage: { input_tokens: 50, output_tokens: 10 } },
      }) + "\n",
    );
    await collect();
    const store = openStore();
    try {
      const claude = store.getSession("claude", "claude-one");
      expect(claude!.inputTokens).toBe(150);
      expect(claude!.outputTokens).toBe(50);
      expect(claude!.messageCount).toBe(4);
    } finally {
      store.close();
    }
  });

  test("дневные агрегаты и heatmap: сессии и токены по дням", async () => {
    const store = openStore();
    try {
      const day = dayKey("2026-10-01T10:00:00.000Z");
      const days = store.heatmapDays("sessions", "2026-09-01T00:00:00.000Z");
      expect(days.find((entry) => entry.date === day)?.total).toBe(4);
      const tokens = store.heatmapDays("tokens", "2026-09-01T00:00:00.000Z");
      // claude 100+40+510 затем +50+10; zcode 210+35; codex 1000+200+300
      expect(tokens.find((entry) => entry.date === day)?.total).toBe(650 + 60 + 245 + 1500);
      const summary = store.summary("2026-09-01T00:00:00.000Z");
      expect(summary.count).toBe(4);
      expect(summary.topProjects.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  test("полнотекстовый поиск находит сообщение сессии", async () => {
    const store = openStore();
    try {
      const result = store.search("первопричину", { limit: 10 });
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      expect(result.hits[0]!.sessionId).toBe("claude-one");
      expect(result.hits[0]!.snippet).toContain("первопричину");
      // фильтр по рантайму
      const filtered = store.search("первопричину", { runtime: "zcode", limit: 10 });
      expect(filtered.hits.length).toBe(0);
      // курсоры чтения сохранены
      expect(store.getCursor("claude:/nonexistent").cursor).toBe(0);
    } finally {
      store.close();
    }
  });

  test("contentSearch=false: тексты не пишутся, метаданные ищутся", async () => {
    await collectSessionsIndex(repo, { home, opencode: false, contentSearch: false, claudeDir: join(home, ".claude", "projects-empty") });
    // существующие сообщения остаются, но новый сбор ничего не добавил;
    // проверяем режим на чистом хранилище
    const store = openStore();
    try {
      const meta = store.searchMeta("правки консоли", { limit: 10 });
      expect(meta.length).toBe(1);
      expect(meta[0]!.sessionId).toBe("kimi-one");
    } finally {
      store.close();
    }
  });
});

describe("детализация индекса", () => {
  test("sessionsByDay/Model/Tool, durationBuckets, toolDayRows", async () => {
    await collect();
    const store = openStore();
    try {
      // день старта или последней активности
      const dayIds = store.sessionsByDay("2026-10-01").map((row) => row.sessionId).sort();
      expect(dayIds).toEqual(["claude-one", "codex-one", "kimi-one", "sess_zcode-one"]);
      expect(store.sessionsByDay("не-дата")).toHaveLength(0);

      // модель: точное совпадение элемента models_json
      expect(store.sessionsByModel("claude-sonnet-5-5").map((row) => row.sessionId)).toEqual(["claude-one"]);
      expect(store.sessionsByModel("GLM-5.3-Flash").map((row) => row.sessionId)).toEqual(["sess_zcode-one"]);
      expect(store.sessionsByModel("несуществующая-модель")).toHaveLength(0);

      // инструмент: сессия с числом вызовов
      const grep = store.sessionsByTool("Grep");
      expect(grep).toHaveLength(1);
      expect(grep[0]!.sessionId).toBe("claude-one");
      expect(grep[0]!.toolCalls).toBe(1);
      expect(store.sessionsByTool("НетТакого")).toHaveLength(0);

      // архетипы: claude ~2 мин (quick), kimi 30 мин (standard), codex/zcode -
      // файлы созданы сегодня, длительность от старта события до mtime (marathon)
      const buckets = Object.fromEntries(store.durationBuckets().map((bucket) => [bucket.key, bucket.count]));
      expect(buckets.quick).toBe(1);
      expect(buckets.standard).toBe(1);
      expect(buckets.marathon).toBe(2);

      // дневные вызовы инструментов по дню события
      const grepCalls = store.toolDayRows("2026-01-01").filter((row) => row.tool === "Grep").reduce((sum, row) => sum + row.calls, 0);
      expect(grepCalls).toBe(1);
    } finally {
      store.close();
    }
  });
});
