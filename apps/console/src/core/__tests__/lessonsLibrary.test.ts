import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptedLessonsBlock,
  collectRunLessons,
  lessonDomain,
  lessonsDir,
  listLessons,
  parseLessonProposals,
  setLessonStatus,
  type LessonRecord,
} from "@/core/lessonsLibrary";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "lessons-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const PROPOSALS = [
  "```json",
  JSON.stringify(
    [
      { target: ".agents/roles/product/verifier.md", kind: "role", title: "Сверять DoD до ревью", diff: "", reason: "Три возврата из-за пропущенного критерия", category: "auto" },
      { target: ".mcp.json", kind: "manual", title: "Починить эндпоинт deepwiki", diff: "", reason: "40 событий mcp-unavailable", category: "manual" },
    ],
    null,
    2,
  ),
  "```",
].join("\n");

describe("parseLessonProposals", () => {
  test("блок ```json со списком разбирается", () => {
    const items = parseLessonProposals("# Заголовок\n\n" + PROPOSALS);
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe("role");
    expect(items[1].category).toBe("manual");
  });

  test("несколько блоков - берётся последний со списком", () => {
    const text = '```json\n{"verdict":"pass"}\n```\nпояснение\n' + PROPOSALS;
    expect(parseLessonProposals(text).length).toBe(2);
  });

  test("пустые заголовки отбрасываются, без блока - пустой список", () => {
    expect(parseLessonProposals('```json\n[{"target":"x","title":"  ","kind":"manual"}]\n```').length).toBe(0);
    expect(parseLessonProposals("текст без блоков")).toEqual([]);
  });
});

describe("lessonDomain", () => {
  test("цель определяет домен", () => {
    expect(lessonDomain({ target: ".agents/roles/engineering/backend.md", kind: "role" })).toBe("role");
    expect(lessonDomain({ target: ".agents/skills/master/workflows/sdlc.yaml", kind: "manual" })).toBe("workflow");
    expect(lessonDomain({ target: "lessons-learned", kind: "skill" })).toBe("skill");
    expect(lessonDomain({ target: ".agents/runtime/zcode/config.json", kind: "manual" })).toBe("runtime");
    expect(lessonDomain({ target: ".mcp.json", kind: "manual" })).toBe("repo");
  });
});

describe("библиотека уроков", () => {
  test("агрегация из прогонов и спринтов идемпотентна", async () => {
    await mkdir(join(root, ".agents", "console", "tasks", "run-1", "lessons"), { recursive: true });
    await writeFile(join(root, ".agents", "console", "tasks", "run-1", "lessons", "proposals.md"), "# Lessons\n\n" + PROPOSALS, "utf8");
    await mkdir(join(root, ".agents", "sprints"), { recursive: true });
    await writeFile(
      join(root, ".agents", "sprints", "sprint-ab-retrospective.md"),
      "# Ретроспектива\n\n```json\n" + JSON.stringify([{ target: "lessons-learned", kind: "skill", title: "Сверять статусы", diff: "", reason: "спринт failed без заявленных ошибок", category: "manual" }]) + "\n```\n",
      "utf8",
    );

    const first = await collectRunLessons(root);
    expect(first.added).toBe(3);
    expect(first.sources).toBe(2);

    const second = await collectRunLessons(root);
    expect(second.added).toBe(0);

    const lessons = await listLessons(root);
    expect(lessons.length).toBe(3);
    expect(lessons.every((lesson) => lesson.status === "proposed")).toBe(true);
    expect(lessons.some((lesson) => lesson.provenance.sprintId === "sprint-ab")).toBe(true);
    expect(join(lessonsDir(root)).startsWith(root)).toBe(true);
  });

  test("статус меняется только из proposed", async () => {
    const lessons = await listLessons(root);
    const target = lessons.find((lesson) => lesson.domain === "role")!;
    const adopted = await setLessonStatus(root, target.id, "adopted");
    expect(adopted?.status).toBe("adopted");
    expect(adopted?.adoptedAt).not.toBeNull();
    // повторная смена игнорируется
    const again = await setLessonStatus(root, target.id, "rejected");
    expect(again?.status).toBe("adopted");
    expect(await setLessonStatus(root, "LESSON-deadbeefdeadbeef", "adopted")).toBeNull();
  });

  test("блок внедрения содержит только принятые и ограничен по объёму", () => {
    const base = {
      apiVersion: "harness/v1" as const,
      kind: "Lesson" as const,
      statement: "",
      reason: "",
      target: "",
      proposalKind: "manual" as const,
      createdAt: "2026-10-25T00:00:00.000Z",
      updatedAt: "2026-10-25T00:00:00.000Z",
      adoptedAt: null,
      provenance: { source: "run-lessons" as const, runId: "run-1", sprintId: "", fingerprint: "0".repeat(16) },
    };
    const lessons: LessonRecord[] = [
      { ...base, id: "LESSON-0000000000000001", status: "proposed", domain: "skill", title: "черновик" },
      { ...base, id: "LESSON-0000000000000002", status: "adopted", domain: "role", statement: "При ревью сверяй DoD", title: "старый заголовок", target: ".agents/roles/product/verifier.md" },
    ];
    const block = adoptedLessonsBlock(lessons);
    expect(block).toContain("Принятые уроки");
    expect(block).toContain("При ревью сверяй DoD");
    expect(block).not.toContain("черновик");

    const many: LessonRecord[] = Array.from({ length: 50 }, (_, index) => ({
      ...base,
      id: "LESSON-" + String(index).padStart(16, "0"),
      status: "adopted",
      domain: "repo",
      title: "правило " + "x".repeat(100) + index,
    }));
    expect(adoptedLessonsBlock(many).length).toBeLessThanOrEqual(2200);
    expect(adoptedLessonsBlock([])).toBe("");
  });
});
