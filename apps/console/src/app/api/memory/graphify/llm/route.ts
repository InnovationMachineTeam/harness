import { NextResponse } from "next/server";
import { graphifyLlmConfig } from "@/core/openwikiLlm";
import { presetById, GRAPHIFY_PRESETS } from "@/core/llmPresets";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/memory/graphify/llm - LLM-бэкенд сборки Graphify
 * (state.graphifyLlm; env-ключ передаётся в graphify CLI при сборке;
 * preset "auto" - ключи берутся из окружения). Ключ - локально в state.json.
 */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({ llm: graphifyLlmConfig(ctx.state) });
}

export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as {
    preset?: unknown;
    apiKey?: unknown;
  } | null;
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const presetId = str(body?.preset, 64) || "auto";
  const preset = presetById(GRAPHIFY_PRESETS, presetId);
  if (!preset) return NextResponse.json({ error: `неизвестный пресет: ${presetId}` }, { status: 400 });
  const apiKey = str(body?.apiKey, 256);
  ctx.state.graphifyLlm = { preset: preset.id, apiKey };
  await ctx.saveState();
  return NextResponse.json({ ok: true, llm: { preset: preset.id, apiKey } });
}
