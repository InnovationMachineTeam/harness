import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCasePrompt,
  buildJudgePrompt,
  listSkillEvalsSummaries,
  parseEvalsJson,
  parseJudgeVerdict,
  readSkillEvalsCatalog,
  renderReportMarkdown,
  skillEvalsDir,
  summarizeReport,
  type CaseResult,
  type SkillEvalsReport,
} from "@/core/skillEvals";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "skill-evals-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const EVALS_JSON = JSON.stringify({
  skill_name: "demo",
  evals: [
    { id: "one", prompt: "Запрос один", expected_output: "Ожидание один", assertions: ["Утверждение А", "Утверждение Б"] },
    { id: "two", prompt: "Запрос два", expected_output: "", assertions: [] },
  ],
});

describe("parseEvalsJson", () => {
  test("кейсы разбираются, пустые промпты отбрасываются", () => {
    const cases = parseEvalsJson(EVALS_JSON);
    expect(cases.length).toBe(2);
    expect(cases[0].assertions).toEqual(["Утверждение А", "Утверждение Б"]);
    expect(cases[1].expectedOutput).toBe("");
    expect(parseEvalsJson("{ошибка")).toEqual([]);
    expect(parseEvalsJson('{"evals": [{"prompt": ""}]}')).toEqual([]);
  });
});

describe("промпты и вердикт судьи", () => {
  test("промпт кейса содержит методологию и запрос", () => {
    const prompt = buildCasePrompt({ skillId: "demo", title: "Demo", content: "# Методология" }, parseEvalsJson(EVALS_JSON)[0]);
    expect(prompt).toContain("demo");
    expect(prompt).toContain("# Методология");
    expect(prompt).toContain("Запрос один");
  });

  test("промпт судьи содержит утверждения и фактический ответ", () => {
    const evalCase = parseEvalsJson(EVALS_JSON)[0];
    const prompt = buildJudgePrompt(evalCase, "Фактический ответ");
    expect(prompt).toContain("- Утверждение А");
    expect(prompt).toContain("Фактический ответ");
  });

  test("вердикт разбирается из чистого JSON и из текста с пояснением", () => {
    const json = '{"pass":false,"assertions":[{"text":"А","pass":true,"note":"ок"}],"comment":"вывод"}';
    const strict = parseJudgeVerdict(json);
    expect(strict?.pass).toBe(false);
    expect(strict?.assertions[0].pass).toBe(true);
    const wrapped = parseJudgeVerdict("Пояснение:\n" + json + "\nконец");
    expect(wrapped?.comment).toBe("вывод");
    expect(parseJudgeVerdict("не JSON")).toBeNull();
  });
});

describe("каталог evals и сводки", () => {
  test("каталог находит навыки с evals, без evals пропускаются", async () => {
    const skillDir = join(root, ".agents", "skills", "master", "skills", "demo");
    await mkdir(join(skillDir, "evals"), { recursive: true });
    await writeFile(
      join(skillDir, "manifest.yaml"),
      ["apiVersion: harness/v1", "kind: InternalSkill", "id: demo", "title: Demo", "description: Тестовый навык", "source: {version: 1.0.0, hash: h1, update: manual-review}", "runtimes: [zcode]", "tags: []"].join("\n"),
      "utf8",
    );
    await writeFile(join(skillDir, "SKILL.md"), "# Demo методология\n", "utf8");
    await writeFile(join(skillDir, "evals", "evals.json"), EVALS_JSON, "utf8");

    const catalog = await readSkillEvalsCatalog(root);
    expect(catalog.length).toBe(1);
    expect(catalog[0].skillId).toBe("demo");
    expect(catalog[0].cases.length).toBe(2);
  });

  test("сводка считает pass/fail/ошибки, markdown содержит таблицу", async () => {
    const result = (pass: boolean, ok = true): CaseResult => ({
      skillId: "demo", caseId: "one", runtime: "provider:test", ok, error: ok ? null : "timeout", output: "", usage: null, costUsd: null,
      verdict: ok ? { pass, assertions: [], comment: "" } : null, durationMs: 5,
    });
    const report: SkillEvalsReport = {
      id: "job-1", status: "completed", startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z",
      judge: "provider:test", judgeModel: "m", runtimes: ["provider:test"],
      skills: [{ skillId: "demo", title: "Demo", caseCount: 2 }],
      results: [result(true), result(false), result(false, false)],
      error: null,
    };
    const summary = summarizeReport(report);
    expect(summary.totals).toEqual({ cases: 3, passed: 1, failed: 1, errors: 1 });
    expect(summary.skills[0].passed).toBe(1);
    expect(summary.skills[0].judged).toBe(2);

    const dir = skillEvalsDir(root, "job-1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "report.json"), JSON.stringify(report), "utf8");
    const summaries = await listSkillEvalsSummaries(root);
    expect(summaries.length).toBe(1);
    expect(summaries[0].id).toBe("job-1");

    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain("| Навык | Кейсов | Пройдено |");
    expect(markdown).toContain("demo / one");
  });
});
