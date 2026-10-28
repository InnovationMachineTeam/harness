import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyOverrides,
  buildContrastPrompt,
  buildProbePrompt,
  markProbeAdopted,
  overridePathAllowed,
  parseProposedVariants,
  parseRecommendation,
  parseVariantsInput,
  probeArtifactsDir,
  readProbeRun,
  PROBE_MAX_VARIANTS,
} from "@/core/probing";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "probe-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("overridePathAllowed", () => {
  test("whitelist: AGENTS.md, роли, SKILL.md навыков", () => {
    expect(overridePathAllowed("AGENTS.md")).toBe(true);
    expect(overridePathAllowed(".agents/roles/product/verifier.md")).toBe(true);
    expect(overridePathAllowed(".agents/skills/master/skills/demo/SKILL.md")).toBe(true);
  });

  test("вне whitelist и обход пути отклоняются", () => {
    expect(overridePathAllowed(".agents/skills/master/skills/demo/evals/evals.json")).toBe(false);
    expect(overridePathAllowed(".mcp.json")).toBe(false);
    expect(overridePathAllowed("package.json")).toBe(false);
    expect(overridePathAllowed("../outside.md")).toBe(false);
    expect(overridePathAllowed(".agents/roles/../../escape.md")).toBe(false);
  });
});

describe("parseVariantsInput", () => {
  test("валидные варианты проходят, поля санитизируются", () => {
    const result = parseVariantsInput([{ id: "v1", label: "Строгий", contextBlock: "Правила", fileOverrides: [{ path: ".agents/roles/product/verifier.md", content: "новая роль" }] }]);
    expect(typeof result).not.toBe("string");
    if (typeof result !== "string") {
      expect(result.variants[0].fileOverrides[0].content).toBe("новая роль");
    }
  });

  test("нарушения ограничений возвращают ошибку", () => {
    expect(typeof parseVariantsInput([])).toBe("string");
    expect(typeof parseVariantsInput(Array.from({ length: PROBE_MAX_VARIANTS + 1 }, (_, index) => ({ id: "v" + index })))).toBe("string");
    expect(typeof parseVariantsInput([{ id: "a" }, { id: "a" }])).toBe("string");
    expect(typeof parseVariantsInput([{ id: "v1", fileOverrides: [{ path: "package.json", content: "x" }] }])).toBe("string");
  });
});

describe("промпты и разборы", () => {
  test("промпт пробы содержит задачу и блок варианта", () => {
    const prompt = buildProbePrompt("Сделай X", { id: "v1", label: "Строгий", contextBlock: "Сначала план" });
    expect(prompt).toContain("Сделай X");
    expect(prompt).toContain("Строгий");
    expect(prompt).toContain("Сначала план");
  });

  test("контрастный промпт содержит варианты и результаты", () => {
    const prompt = buildContrastPrompt(
      { taskPrompt: "Задача", variants: [{ id: "v1", label: "A", contextBlock: "", fileOverrides: [] }] },
      [{ variantId: "v1", label: "A", worktree: "/w", branch: "b", ok: true, error: null, output: "ответ", usage: null, costUsd: 0.1, durationMs: 5000 }],
    );
    expect(prompt).toContain("Задача");
    expect(prompt).toContain("v1");
    expect(prompt).toContain("ответ");
  });

  test("рекомендация разбирается из JSON-блока, null допустим", () => {
    const text = 'Отчёт\n\n## Контраст\nтекст\n```json\n{"variantId":"v2","rationale":"быстрее и полнее"}\n```';
    expect(parseRecommendation(text)).toEqual({ variantId: "v2", rationale: "быстрее и полнее" });
    expect(parseRecommendation('```json\n{"variantId":null,"rationale":"нет"}\n```')).toEqual({ variantId: null, rationale: "нет" });
    expect(parseRecommendation("без блока")).toBeNull();
  });

  test("предложенные варианты разбираются из конверта и валидируются", () => {
    const text = 'пояснение {"variants":[{"id":"strict","label":"Строгий","contextBlock":"План"},{"id":"free","label":"Свободный","contextBlock":""}]} конец';
    const variants = parseProposedVariants(text, 2);
    expect(variants.length).toBe(2);
    expect(variants[0].id).toBe("strict");
    expect(parseProposedVariants("мусор", 2)).toEqual([]);
  });
});

describe("файлы пробы", () => {
  test("замены применяются только внутри каталога", async () => {
    const dir = join(root, "wt");
    await applyOverrides(dir, [{ path: ".agents/roles/product/verifier.md", content: "роль" }, { path: "AGENTS.md", content: "# правила" }]);
    expect(await readFile(join(dir, ".agents", "roles", "product", "verifier.md"), "utf8")).toBe("роль");
    await expect(applyOverrides(dir, [{ path: "../escape.md", content: "x" }])).rejects.toThrow("недопустимый путь");
  });

  test("чтение пробы и отметка внедрения", async () => {
    const id = "probe-test-1";
    const run = {
      id, status: "completed", startedAt: "2026-10-25T00:00:00.000Z", finishedAt: null,
      workspaceDir: root, runtimeId: "zcode", model: null, taskPrompt: "Задача",
      variants: [{ id: "v1", label: "A", contextBlock: "", fileOverrides: [] }],
      results: [], contrast: null, recommendation: null, adoptedVariantId: null, error: null,
    };
    const dir = probeArtifactsDir(root, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "probe.json"), JSON.stringify(run), "utf8");
    expect((await readProbeRun(root, id))?.variants.length).toBe(1);
    const updated = await markProbeAdopted(root, id, "v1");
    expect(updated?.adoptedVariantId).toBe("v1");
    expect(await markProbeAdopted(root, id, "missing")).toBeNull();
    expect(await readProbeRun(root, "no-such-probe")).toBeNull();
  });
});
