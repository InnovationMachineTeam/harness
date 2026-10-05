import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerUsageSummary, readProviderUsage } from "@/core/providerUsage";
import { collectRuntimeUsage } from "@/core/usage/runtimeTranscripts";
import { collectToolLedgers } from "@/core/usage/toolLedgers";

let home = "";
let repo = "";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "usage-home-"));
  repo = await mkdtemp(join(tmpdir(), "usage-repo-"));
  // фикстура vendor-конфига для атрибуции
  await mkdir(join(repo, ".agents", "runtime", "fakevendor"), { recursive: true });
  await appendFile(join(repo, ".agents", "runtime", "fakevendor", "config.json"), JSON.stringify({ models: { fast: { model: "FakeModel-X" } } }));

  /* Claude: сессия с реальным usage, синтетической и ошибочной записями */
  const claudeProject = join(home, ".claude", "projects", "-tmp-project");
  await mkdir(claudeProject, { recursive: true });
  const claudeFile = join(claudeProject, "session-one.jsonl");
  await appendFile(
    claudeFile,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "привет" }, sessionId: "s1" }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-01T10:00:00.000Z",
        sessionId: "s1",
        uuid: "u1",
        message: {
          id: "m1",
          model: "claude-sonnet-5-5",
          usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
        },
      }),
      // синтетическая запись об ошибке - пропускается
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-01T10:00:01.000Z",
        sessionId: "s1",
        uuid: "u2",
        isApiErrorMessage: true,
        message: { id: "m2", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } },
      }),
    ].join("\n") + "\n",
  );

  /* ZCode: два запроса, один дубль requestId */
  const zcodeDir = join(home, ".zcode", "cli", "rollout");
  await mkdir(zcodeDir, { recursive: true });
  const zcodeFile = join(zcodeDir, "model-io-sess_test-session.jsonl");
  const zcodeRecord = (requestId: string, input: number, output: number) =>
    JSON.stringify({
      requestId,
      startedAt: "2026-10-01T11:00:00.000Z",
      completedAt: "2026-10-01T11:00:05.000Z",
      model: { modelId: "GLM-5.3-Flash", providerId: "account:test" },
      response: { usage: { inputTokens: input, outputTokens: output, totalTokens: input + output, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    });
  await appendFile(zcodeFile, [zcodeRecord("r1", 200, 30), zcodeRecord("r2", 10, 5), zcodeRecord("r2", 10, 5)].join("\n") + "\n");

  /* Codex: кумулятивный token_count в rollout-файле */
  const codexDay = join(home, ".codex", "sessions", "2026", "10", "01");
  await mkdir(codexDay, { recursive: true });
  const codexFile = join(codexDay, "rollout-2026-10-01T00-00-00-11111111-2222-3333-4444-555555555555.jsonl");
  await appendFile(
    codexFile,
    [
      JSON.stringify({ timestamp: "2026-10-01T09:00:00.000Z", type: "session_meta", payload: { cwd: "/tmp", session_id: "codex-s1" } }),
      JSON.stringify({
        timestamp: "2026-10-01T09:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 200, cached_input_tokens: 300, reasoning_output_tokens: 50, total_tokens: 1200 } },
        },
      }),
    ].join("\n") + "\n",
  );

  /* Graphify ledger и headroom events */
  await mkdir(join(repo, "graphify-out"), { recursive: true });
  await appendFile(join(repo, "graphify-out", ".graphify_cost.json"), JSON.stringify({ total_input_tokens: 100, total_output_tokens: 40 }));
  const headroomDir = join(home, ".headroom");
  await mkdir(headroomDir, { recursive: true });
  await appendFile(
    join(headroomDir, "savings_events.jsonl"),
    [
      JSON.stringify({ v: 2, ts: "2026-10-01T12:00:00Z", saved: 367, model: "claude-sonnet-5-5", provider: "anthropic", client: "claude-code", new_input: 38064 }),
      JSON.stringify({ v: 2, ts: "2026-10-01T12:05:00Z", saved: 0, model: "claude-sonnet-5-5", provider: "anthropic", client: "claude-code" }),
    ].join("\n") + "\n",
  );
});

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  if (repo) await rm(repo, { recursive: true, force: true });
});

describe("collectRuntimeUsage", () => {
  test("первый сбор: все рантаймы, атрибуция по модели, дубли и синтетика пропущены", async () => {
    const added = await collectRuntimeUsage(repo, { home });
    // claude: 1 запись; zcode: 2 (дубль r2 пропущен); codex: 1
    expect(added).toBe(4);
    const { totals, records } = await providerUsageSummary(repo);
    expect(totals.anthropic.calls).toBe(1);
    expect(totals.anthropic.models["claude-sonnet-5-5"].inputTokens).toBe(100);
    expect(totals["runtime:zcode"].calls).toBe(2);
    expect(totals["runtime:zcode"].models["GLM-5.3-Flash"].totalTokens).toBe(245);
    expect(totals["runtime:codex"].totalTokens).toBe(1200);
    const codex = records.find((r) => r.provider === "runtime:codex");
    expect(codex?.details?.cachedInputTokens).toBe(300);
  });

  test("повторный сбор без изменений не добавляет записи", async () => {
    const added = await collectRuntimeUsage(repo, { home });
    expect(added).toBe(0);
  });

  test("дозапись в транскрипты даёт только дельты (codex - кумулятивно)", async () => {
    const zcodeFile = join(home, ".zcode", "cli", "rollout", "model-io-sess_test-session.jsonl");
    await appendFile(zcodeFile, JSON.stringify({
      requestId: "r3",
      startedAt: "2026-10-01T12:00:00.000Z",
      model: { modelId: "FakeModel-X", providerId: "account:test" },
      response: { usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    }) + "\n");

    const codexDay = join(home, ".codex", "sessions", "2026", "10", "01");
    const codexFile = join(codexDay, "rollout-2026-10-01T00-00-00-11111111-2222-3333-4444-555555555555.jsonl");
    await appendFile(codexFile, JSON.stringify({
      timestamp: "2026-10-01T09:05:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 1500, output_tokens: 300, cached_input_tokens: 300, reasoning_output_tokens: 50, total_tokens: 1800 } },
      },
    }) + "\n");

    const added = await collectRuntimeUsage(repo, { home });
    // zcode: +1 (FakeModel-X атрибутируется fakevendor); codex: +1 дельта (500 вход + 100 выход)
    expect(added).toBe(2);
    const { totals, records } = await providerUsageSummary(repo);
    expect(totals["runtime:fakevendor"].models["FakeModel-X"].totalTokens).toBe(10);
    const codexRecords = records.filter((r) => r.provider === "runtime:codex");
    const delta = codexRecords[codexRecords.length - 1];
    expect(delta.inputTokens).toBe(500);
    expect(delta.outputTokens).toBe(100);
  });

  test("обрезанная строка не теряется: парсируется после дозаписи перевода строки", async () => {
    const claudeProject = join(home, ".claude", "projects", "-tmp-project");
    const file = join(claudeProject, "session-two.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-01T13:00:00.000Z",
      sessionId: "s2",
      message: { id: "m3", model: "claude-sonnet-5-5", usage: { input_tokens: 7, output_tokens: 3 } },
    });
    await appendFile(file, line); // без перевода строки
    expect(await collectRuntimeUsage(repo, { home })).toBe(0);
    await appendFile(file, "\n");
    expect(await collectRuntimeUsage(repo, { home })).toBe(1);
  });
});

describe("collectToolLedgers", () => {
  test("graphify: дельта итогов; headroom: события с атрибуцией провайдера", async () => {
    const added = await collectToolLedgers(repo, { home });
    // graphify: 1; headroom: 1 (событие с saved=0 пропущено)
    expect(added).toBe(2);
    const { totals, records } = await providerUsageSummary(repo);
    expect(totals.graphify.totalTokens).toBe(140);
    const headroom = records.find((r) => r.source === "tool-ledger" && r.kind === "headroom:claude-code");
    expect(headroom?.provider).toBe("anthropic");
    expect(headroom?.totalTokens).toBe(367);
    expect(headroom?.details?.newInputTokens).toBe(38064);
  });

  test("повторный сбор graphify без изменений не добавляет записи", async () => {
    expect(await collectToolLedgers(repo, { home })).toBe(0);
  });

  test("рост итогов graphify даёт дельту", async () => {
    const file = join(repo, "graphify-out", ".graphify_cost.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify({ total_input_tokens: 250, total_output_tokens: 100 }), "utf8");
    expect(await collectToolLedgers(repo, { home })).toBe(1);
    const { totals } = await providerUsageSummary(repo);
    expect(totals.graphify.totalTokens).toBe(140 + 150 + 60);
  });

  test("курсоры коллекторов сохранены в файле", async () => {
    const store = await readProviderUsage(repo);
    expect(Object.keys(store.cursors).some((key) => key.startsWith("claude:"))).toBe(true);
    expect(Object.keys(store.cursors).some((key) => key.startsWith("zcode:"))).toBe(true);
    expect(Object.keys(store.cursors).some((key) => key.startsWith("codex:"))).toBe(true);
    expect(Object.keys(store.cursors).some((key) => key.startsWith("headroom:"))).toBe(true);
  });
});
