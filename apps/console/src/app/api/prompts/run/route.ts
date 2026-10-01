import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { buildFixPrompt, launchPromptRun } from "@/core/prompts";
import { resolveTaskRuntime } from "@/core/state";
import type { Issue } from "@/core/types";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Типовые ошибки запуска headless-рантайма, видимые в логе. */
const LAUNCH_FAILURES: { pattern: RegExp; hint: string }[] = [
  {
    pattern: /Failed to authenticate/i,
    hint: "рантайм не аутентифицирован - выполните вход интерактивно (например, `claude` в терминале) или выберите другой рантайм ★",
  },
  {
    pattern: /Model creation failed/i,
    hint: "рантайм не смог создать модель - проверьте его авторизацию/конфиг (запустите интерактивно) или выберите другой рантайм ★",
  },
  {
    pattern: /KEY_MISSING|API key .*required|OPENAI_API_KEY is required/i,
    hint: "в окружении нет LLM-ключа - экспортируйте OPENAI_API_KEY (или ключ нужного провайдера) и повторите; локальные code-only сборки работают без ключа",
  },
];

/**
 * POST /api/prompts/run {prompt?, issue?, runtime?}
 * Запуск промта в НОВОЙ headless-сессии. Рантайм: явный → настройка задачи
 * "Исполнение команд" → рантайм по умолчанию (★). Процесс отвязанный; вывод - в
 * .agents/console/runs/<ts>-<runtime>.log. Спустя паузу лог проверяется на
 * типовые ошибки запуска (аутентификация/доверие) - чтобы UI сразу показал
 * причину, а не "сессия запущена" при остановившемся процессе.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { prompt?: string; issue?: Issue; runtime?: string; issueRuntime?: string }
    | null;

  const runtimeId = body?.runtime ?? resolveTaskRuntime(ctx.state, "promptExecution");
  if (!runtimeId) {
    return NextResponse.json(
      { error: "не выбран рантайм - назначьте его в настройках для \"Исполнение команд\" или выберите ★" },
      { status: 400 },
    );
  }
  const adapter = ctx.adapters[runtimeId];
  if (!adapter) return NextResponse.json({ error: `неизвестный рантайм: ${runtimeId}` }, { status: 400 });

  let prompt = body?.prompt?.trim();
  if (!prompt && body?.issue) {
    prompt = buildFixPrompt(body.issue, body.issueRuntime ?? runtimeId, ctx.repoRoot);
  }
  if (!prompt) {
    return NextResponse.json({ error: "нужен prompt или issue" }, { status: 400 });
  }
  if (prompt.length > 32_000) {
    return NextResponse.json({ error: "промт слишком длинный (макс. 32000 символов)" }, { status: 400 });
  }

  const result = await launchPromptRun({
    repoRoot: ctx.repoRoot,
    adapter,
    runtimeId,
    prompt,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  // короткая пауза и проверка лога на мгновенные фейлы запуска
  await new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    const log = await readFile(result.logFile, "utf8");
    for (const { pattern, hint } of LAUNCH_FAILURES) {
      if (pattern.test(log)) {
        return NextResponse.json({ ...result, warning: `сессия сразу завершилась: ${hint}` }, { status: 200 });
      }
    }
  } catch {
    /* лог ещё не записан - не критично */
  }
  return NextResponse.json(result, { status: 200 });
}
