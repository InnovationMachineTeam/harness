import { NextResponse } from "next/server";
import { runAgentLoop } from "@/core/agentLoop";
import { providerBaseUrlError, providerPresetById, parseTaskProviderId, FALLBACK_PROVIDER_ID, type ModelTier } from "@/core/providers";
import { resolveProviderCandidate } from "@/core/agentTools";
import { loadConsoleState, resolveTaskRuntime } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const SYSTEM = [
  "Ты редактируешь формулировки задач для workflow Harness.",
  "Перепиши задачу оператора: сохрани смысл и все факты, устрани разговорные обороты, добавь структуру - проблема или возможность, целевая аудитория, ожидаемый результат.",
  "Ничего не выдумывай: недостающие детали оставь как открытый вопрос в конце.",
  "Ответ - только переписанный текст задачи, без пояснений и без оград.",
].join("\n");

/** Провайдер для улучшения промта: назначенный на задачу promptExecution, иначе ollama. */
async function improveProviderCandidate(repoRoot: string) {
  const state = await loadConsoleState(repoRoot);
  const assigned = resolveTaskRuntime(state, "promptExecution");
  const candidates = [parseTaskProviderId(assigned ?? "") ?? "", FALLBACK_PROVIDER_ID].filter(Boolean);
  const errors: string[] = [];
  for (const providerId of [...new Set(candidates)]) {
    const preset = providerPresetById(providerId);
    if (!preset) { errors.push(`провайдер не найден в реестре: ${providerId}`); continue; }
    const resolved = await resolveProviderCandidate(repoRoot, "provider:" + providerId, state);
    if (resolved.ok) {
      const baseUrlError = providerBaseUrlError(resolved.candidate.entry.baseUrl, resolved.candidate.preset.kind);
      if (baseUrlError) { errors.push(baseUrlError); continue; }
      return { resolved, errors };
    }
    if (resolved.error) errors.push(resolved.error);
  }
  return { resolved: null, errors };
}

/**
 * POST /api/prompts/improve - автоулучшение формулировки задачи оператора.
 * Исполнение in-process через LangChain-цикл; провайдер - назначенный на задачу
 * "promptExecution" (fallback ollama).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { prompt?: string } | null;
  const prompt = String(body?.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt обязателен" }, { status: 400 });
  if (prompt.length > 32_000) return NextResponse.json({ error: "промт больше 32000 символов" }, { status: 400 });
  try {
    const ctx = await serverContext();
    const { resolved, errors } = await improveProviderCandidate(ctx.repoRoot);
    if (!resolved) return NextResponse.json({ error: errors.join("; ") || "нет активного провайдера" }, { status: 400 });
    const model = resolved.candidate.entry.models["standard" as ModelTier]?.trim() || resolved.candidate.entry.models["fast" as ModelTier]?.trim();
    if (!model) return NextResponse.json({ error: `у провайдера ${resolved.candidate.providerId} не задана модель` }, { status: 400 });
    const result = await runAgentLoop({
      repoRoot: ctx.repoRoot,
      providerId: resolved.candidate.providerId,
      preset: resolved.candidate.preset,
      entry: resolved.candidate.entry,
      model,
      system: SYSTEM,
      prompt,
      toolCwd: ctx.repoRoot,
      timeoutMs: 120_000,
      maxRounds: 1,
    });
    if (!result.ok || !result.text.trim()) {
      return NextResponse.json({ error: result.error ?? "провайдер вернул пустой ответ" }, { status: 502 });
    }
    return NextResponse.json({ prompt: result.text.trim(), provider: resolved.candidate.providerId, model });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
