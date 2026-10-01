import { NextResponse } from "next/server";
import { launchPromptRun } from "@/core/prompts";
import { resolveTaskRuntime } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export interface CreateSkillAnswers {
  name?: string;
  summary?: string;
  details?: string;
  examples?: string;
}

/** Промпт создания навыка: использует skill-creator-навык агента, кладёт в .agents/skills. */
function buildCreateSkillPrompt(answers: CreateSkillAnswers, repoRoot: string): string {
  const name = (answers.name ?? "").trim() || "new-skill";
  return [
    `Создай новый агентский навык "${name}" в репозитории harness.`,
    `Путь: ${repoRoot}/.agents/skills/<slug>/SKILL.md (slug - kebab-case от названия).`,
    "",
    "## О навыке",
    `Название: ${name}`,
    answers.summary ? `Что делает (кратко): ${answers.summary.trim()}` : "",
    answers.details ? `Подробности и правила работы: ${answers.details.trim()}` : "",
    answers.examples ? `Примеры запросов, при которых включать: ${answers.examples.trim()}` : "",
    "",
    "## Требования",
    "- Если у тебя есть навык создания навыков (skill-creator) - используй его.",
    "- SKILL.md: YAML frontmatter (name, description) + лаконичные инструкции.",
    "- Создай только файлы навыка; не изменяй конфиги .agents/runtime и AGENTS.md (guard предупреждает о структурных изменениях).",
    `- Имя каталога: ${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "new-skill"}.`,
    "- В конце кратко отчитайся, что создано.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** POST /api/skills/create {answers, runtime?} - запуск через рантайм задачи "Создание навыка". */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { answers?: CreateSkillAnswers; runtime?: string }
    | null;
  const answers = body?.answers ?? {};
  if (!answers.name?.trim() || !answers.summary?.trim()) {
    return NextResponse.json({ error: "нужны минимум name и summary" }, { status: 400 });
  }

  const runtimeId = body?.runtime ?? resolveTaskRuntime(ctx.state, "skillCreation");
  if (!runtimeId) {
    return NextResponse.json(
      { error: "не выбран рантайм: назначьте его в настройках для задачи \"Создание навыка\" или выберите ★" },
      { status: 400 },
    );
  }
  const adapter = ctx.adapters[runtimeId];
  if (!adapter) return NextResponse.json({ error: `неизвестный рантайм: ${runtimeId}` }, { status: 400 });

  const result = await launchPromptRun({
    repoRoot: ctx.repoRoot,
    adapter,
    runtimeId,
    prompt: buildCreateSkillPrompt(answers, ctx.repoRoot),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
