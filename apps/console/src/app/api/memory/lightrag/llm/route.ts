import { NextResponse } from "next/server";
import { lightragLlmConfig } from "@/core/lightragLlm";
import { LIGHTRAG_PRESETS, presetById } from "@/core/llmPresets";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/memory/lightrag/llm - LLM-биндинг LightRAG (state.lightragLlm;
 * env-переменные передаются lightrag-server при старте управляемого инстанса).
 * Ключ хранится локально в state.json (вне git). По умолчанию - локальный
 * Ollama (preset ollama, host http://localhost:11434).
 */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({ llm: lightragLlmConfig(ctx.state) });
}

export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as {
    preset?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    modelId?: unknown;
    providerId?: unknown;
  } | null;
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const presetId = str(body?.preset, 64) || "ollama";
  const preset = presetById(LIGHTRAG_PRESETS, presetId);
  if (!preset) return NextResponse.json({ error: `неизвестный пресет: ${presetId}` }, { status: 400 });
  const apiKey = str(body?.apiKey, 256) || (preset.apiKeyEnv ? "" : "ollama");
  const baseUrl = str(body?.baseUrl, 256);
  const modelId = str(body?.modelId, 128);
  const providerId = str(body?.providerId, 64) || undefined;
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ error: "baseUrl: только http(s)" }, { status: 400 });
  }
  ctx.state.lightragLlm = { preset: preset.id, apiKey, baseUrl, modelId, providerId };
  await ctx.saveState();
  return NextResponse.json({ ok: true, llm: lightragLlmConfig(ctx.state) });
}
