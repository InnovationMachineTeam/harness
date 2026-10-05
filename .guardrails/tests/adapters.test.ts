import { describe, expect, test } from "bun:test";
import { adaptersCheck } from "../src/adapters";
import { RUNTIME_ADAPTERS } from "../src/runtimeAdapters";
import { INTEGRATIONS } from "../src/integrations";

describe("реестр рантайм-адаптеров", () => {
  test("все шесть рантаймов присутствуют", () =>
    expect(RUNTIME_ADAPTERS.map((adapter) => adapter.id).sort()).toEqual(["claude", "codex", "cursor", "kimi", "opencode", "zcode"]));

  test("check подтверждает все подключённые точки", () => {
    const rows = adaptersCheck(process.cwd());
    expect(rows.every((row) => row.ok)).toBe(true);
  });

  test("записи интеграций выведены из реестра", () => {
    const derived = RUNTIME_ADAPTERS.flatMap((adapter) => adapter.hooks.map((hook) => `runtime:${adapter.id}:${hook.event}`));
    const records = INTEGRATIONS.filter((record) => record.kind === "runtime-hook").map((record) => record.id);
    expect(records.sort()).toEqual(derived.sort());
  });

  test("события отображены на поверхности сканирования", () => {
    const prompt = INTEGRATIONS.find((record) => record.id === "runtime:zcode:UserPromptSubmit");
    const output = INTEGRATIONS.find((record) => record.id === "runtime:zcode:PostToolUse");
    const pre = INTEGRATIONS.find((record) => record.id === "runtime:zcode:PreToolUse");
    expect(prompt?.bundles).toEqual(["prompt"]);
    expect(output?.bundles).toEqual(["tool-output"]);
    expect(pre?.bundles).toEqual(["baseline"]);
  });
});
