import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { findingFingerprint } from "./workflows/roadmap";

/**
 * Библиотека уроков (.agents/lessons/): постоянное хранилище предложений из
 * lessons-шагов прогонов и ретроспектив спринтов. Записи агрегируются вручную
 * (collectRunLessons из API), оператор принимает или отклоняет их; принятые
 * уроки движок workflow внедряет в задания секций (adoptedLessonsContext).
 */

export const LESSON_DOMAINS = ["role", "skill", "workflow", "runtime", "repo"] as const;
export type LessonDomain = (typeof LESSON_DOMAINS)[number];

export type LessonStatus = "proposed" | "adopted" | "rejected";

export const lessonSchema = z.object({
  apiVersion: z.literal("harness/v1"),
  kind: z.literal("Lesson"),
  id: z.string().regex(/^LESSON-[0-9a-f]{16}$/),
  title: z.string().min(1),
  /** Решающее правило урока ("При [условие] выполняй [действие], потому что [эффект]"); заполняется при принятии. */
  statement: z.string().default(""),
  /** Обоснование из источника (reason предложения или выдержка ретроспективы). */
  reason: z.string().default(""),
  /** Цель предложения из источника: путь файла роли/навыка или иной артефакт. */
  target: z.string().default(""),
  /** Тип предложения из lessons-шага: правка роли, навыка или ручное действие. */
  proposalKind: z.enum(["role", "skill", "manual"]).default("manual"),
  domain: z.enum(LESSON_DOMAINS),
  status: z.enum(["proposed", "adopted", "rejected"]),
  provenance: z.object({
    source: z.enum(["run-lessons", "sprint-retrospective"]),
    runId: z.string().default(""),
    sprintId: z.string().default(""),
    fingerprint: z.string(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  adoptedAt: z.string().datetime().nullable().default(null),
});

export type LessonRecord = z.infer<typeof lessonSchema>;

/** Предложение lessons-шага (формат engine.ts parseLessonsProposals). */
export interface LessonProposal {
  target: string;
  kind: "role" | "skill" | "manual";
  title: string;
  diff: string;
  reason: string;
  category: "auto" | "manual";
}

export function lessonsDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "lessons");
}

/** Разбор предложений из ответа ретроспективы: последний блок ```json со списком. */
export function parseLessonProposals(output: string): LessonProposal[] {
  const blocks = output.match(/```json\s*([\s\S]*?)```/g) ?? [];
  for (const block of [...blocks].reverse()) {
    try {
      const parsed = JSON.parse(block.replace(/^```json\s*/, "").replace(/```\s*$/, "")) as unknown;
      if (!Array.isArray(parsed)) continue;
      return parsed
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          target: String(item.target ?? ""),
          kind: item.kind === "skill" ? ("skill" as const) : item.kind === "manual" ? ("manual" as const) : ("role" as const),
          title: String(item.title ?? ""),
          diff: String(item.diff ?? ""),
          reason: String(item.reason ?? ""),
          category: item.category === "manual" ? ("manual" as const) : ("auto" as const),
        }))
        .filter((item) => item.title.trim().length > 0);
    } catch {
      /* не список предложений - следующий блок */
    }
  }
  return [];
}

/** Домен урока по цели предложения и типу. */
export function lessonDomain(proposal: Pick<LessonProposal, "target" | "kind">): LessonDomain {
  const target = proposal.target.trim();
  if (target.startsWith(".agents/roles/")) return "role";
  if (target.includes("/workflows/") || /\.agents\/skills\/master\/workflows\//.test(target)) return "workflow";
  if (proposal.kind === "skill") return "skill";
  if (/\.agents\/runtime\/|^\.agents\/(hooks|mcp_config)\.json|^\.(zcode|claude|codex|cursor|kimi|opencode)\//.test(target)) return "runtime";
  return "repo";
}

function lessonId(fingerprint: string): string {
  return "LESSON-" + fingerprint;
}

/** Урок из предложения источника; идентичность - отпечаток (заголовок + источник + цель). */
function lessonFromProposal(proposal: LessonProposal, source: { kind: "run-lessons" | "sprint-retrospective"; runId?: string; sprintId?: string }, now: string): LessonRecord {
  const runId = source.runId ?? "";
  const sprintId = source.sprintId ?? "";
  const fingerprint = findingFingerprint(proposal.title, [source.kind, runId, sprintId, proposal.target].join("|"));
  return lessonSchema.parse({
    apiVersion: "harness/v1",
    kind: "Lesson",
    id: lessonId(fingerprint),
    title: proposal.title.slice(0, 300),
    statement: "",
    reason: proposal.reason.slice(0, 2000),
    target: proposal.target.slice(0, 300),
    proposalKind: proposal.kind,
    domain: lessonDomain(proposal),
    status: "proposed",
    provenance: { source: source.kind, runId, sprintId, fingerprint },
    createdAt: now,
    updatedAt: now,
    adoptedAt: null,
  });
}

export async function listLessons(repoRoot: string): Promise<LessonRecord[]> {
  const dir = lessonsDir(repoRoot);
  const names = await readdir(dir).catch(() => [] as string[]);
  const items: LessonRecord[] = [];
  for (const name of names.filter((value) => value.startsWith("LESSON-") && value.endsWith(".yaml")).sort()) {
    try {
      items.push(lessonSchema.parse(YAML.parse(await readFile(path.join(dir, name), "utf8"))));
    } catch {
      /* повреждённая запись не ломает библиотеку */
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveLesson(repoRoot: string, lesson: LessonRecord): Promise<void> {
  const dir = lessonsDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, lesson.id + ".yaml");
  const tmp = file + ".tmp";
  await writeFile(tmp, YAML.stringify(lesson, { lineWidth: 0 }), "utf8");
  await rename(tmp, file);
}

/** Итог агрегации: что добавлено и сколько источников прочитано. */
export interface CollectResult {
  added: number;
  sources: number;
  proposals: number;
}

/**
 * Собрать предложения из lessons-артефактов прогонов (.agents/console/tasks/
 * <run>/lessons/proposals.md) и ретроспектив спринтов (.agents/sprints/
 * *-retrospective.md). Идемпотентно: существующий id (тот же заголовок из того
 * же источника) не перезаписывается.
 */
export async function collectRunLessons(repoRoot: string, now = new Date()): Promise<CollectResult> {
  const nowIso = now.toISOString();
  const existing = new Set((await listLessons(repoRoot)).map((lesson) => lesson.id));
  let added = 0;
  let sources = 0;
  let proposals = 0;

  const taskRoot = path.join(repoRoot, ".agents", "console", "tasks");
  const runDirs = await readdir(taskRoot, { withFileTypes: true }).catch(() => []);
  for (const dir of runDirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(taskRoot, dir.name, "lessons", "proposals.md");
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    sources += 1;
    for (const proposal of parseLessonProposals(text)) {
      proposals += 1;
      const lesson = lessonFromProposal(proposal, { kind: "run-lessons", runId: dir.name }, nowIso);
      if (existing.has(lesson.id)) continue;
      await saveLesson(repoRoot, lesson);
      existing.add(lesson.id);
      added += 1;
    }
  }

  const sprintsDir = path.join(repoRoot, ".agents", "sprints");
  const sprintFiles = await readdir(sprintsDir).catch(() => [] as string[]);
  for (const name of sprintFiles.filter((value) => value.endsWith("-retrospective.md")).sort()) {
    const text = await readFile(path.join(sprintsDir, name), "utf8").catch(() => null);
    if (text === null) continue;
    sources += 1;
    const sprintId = name.replace(/-retrospective\.md$/, "");
    for (const proposal of parseLessonProposals(text)) {
      proposals += 1;
      const lesson = lessonFromProposal(proposal, { kind: "sprint-retrospective", sprintId }, nowIso);
      if (existing.has(lesson.id)) continue;
      await saveLesson(repoRoot, lesson);
      existing.add(lesson.id);
      added += 1;
    }
  }

  return { added, sources, proposals };
}

/** Смена статуса: принятие или отклонение возможны только из proposed; при принятии можно задать решающее правило. */
export async function setLessonStatus(
  repoRoot: string,
  id: string,
  status: "adopted" | "rejected",
  opts: { statement?: string; now?: Date } = {},
): Promise<LessonRecord | null> {
  const lessons = await listLessons(repoRoot);
  const lesson = lessons.find((item) => item.id === id);
  if (!lesson) return null;
  if (lesson.status !== "proposed") return lesson;
  const now = (opts.now ?? new Date()).toISOString();
  const updated: LessonRecord = {
    ...lesson,
    status,
    updatedAt: now,
    adoptedAt: status === "adopted" ? now : null,
    statement: status === "adopted" && opts.statement?.trim() ? opts.statement.trim().slice(0, 500) : lesson.statement,
  };
  await saveLesson(repoRoot, updated);
  return updated;
}

const DOMAIN_LABELS: Record<LessonDomain, string> = {
  role: "роль",
  skill: "навык",
  workflow: "workflow",
  runtime: "рантайм",
  repo: "репозиторий",
};

/** Метка домена для интерфейса. */
export function lessonDomainLabel(domain: LessonDomain): string {
  return DOMAIN_LABELS[domain];
}

/** Потолок блока принятых уроков в задании секции. */
export const ADOPTED_CONTEXT_LIMIT = 2048;

/**
 * Блок принятых уроков для задания секции workflow: решающие правила по
 * убыванию свежести, ограничение объёма. Пустая строка - блок не добавляется.
 */
export function adoptedLessonsBlock(lessons: LessonRecord[], limit = ADOPTED_CONTEXT_LIMIT): string {
  const adopted = lessons.filter((lesson) => lesson.status === "adopted");
  if (!adopted.length) return "";
  const lines: string[] = ["## Принятые уроки (библиотека .agents/lessons)", "Учитывай эти решающие правила из прошлых прогонов:"];
  let size = lines.join("\n").length;
  for (const lesson of adopted) {
    const rule = lesson.statement.trim() || lesson.title.trim();
    const line = "- [" + DOMAIN_LABELS[lesson.domain] + "] " + rule + (lesson.target ? " (цель: " + lesson.target + ")" : "");
    if (size + line.length + 1 > limit) break;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.length > 2 ? lines.join("\n") : "";
}

/** Прочитать библиотеку и собрать блок принятых уроков (пустой каталог - пустой блок). */
export async function adoptedLessonsContext(repoRoot: string): Promise<string> {
  return adoptedLessonsBlock(await listLessons(repoRoot));
}
