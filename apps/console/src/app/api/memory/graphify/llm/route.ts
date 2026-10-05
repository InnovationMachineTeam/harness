import { NextResponse } from "next/server";
import { graphifyLlmConfig } from "@/core/openwikiLlm";
import { presetById, GRAPHIFY_PRESETS } from "@/core/llmPresets";
import { isActiveProvider, providerPresetById } from "@/core/providers";
import { readProviderEntry } from "@/core/providerSettings";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/memory/graphify/llm - LLM-бэкенд сборки Graphify
 * (state.graphifyLlm; env-ключ передаётся в graphify CLI при сборке;
 * preset "auto" - ключи берутся из окружения). Ключ - локально в state.json.
 * PUT с providerId (и без полей) выводит пресет и ключ из записи активного
 * провайдера реестра (вкладка "Провайдеры").
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
    modelId?: unknown;
    providerId?: unknown;
  } | null;
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const providerId = str(body?.providerId, 64) || undefined;

  if (providerId) {
    const provider = providerPresetById(providerId);
    const entry = provider
      ? await readProviderEntry(ctx.repoRoot, provider, ctx.state.providers.entries[providerId] ?? null)
      : undefined;
    const graphifyPresetId = provider?.tools.graphify;
    if (!provider || !graphifyPresetId || !presetById(GRAPHIFY_PRESETS, graphifyPresetId)) {
      return NextResponse.json({ error: `провайдер не поддерживает Graphify: ${providerId}` }, { status: 400 });
    }
    if (!isActiveProvider(provider, entry)) {
      return NextResponse.json(
        { error: `провайдер ${provider.label} не активен - заполните поля и пройдите проверку` },
        { status: 400 },
      );
    }
    const modelId = str(body?.modelId, 128) || entry!.models.standard.trim();
    ctx.state.graphifyLlm = { preset: graphifyPresetId, apiKey: entry!.apiKey, modelId, providerId };
    await ctx.saveState();
    return NextResponse.json({ ok: true, llm: graphifyLlmConfig(ctx.state) });
  }

  const presetId = str(body?.preset, 64) || "auto";
  const preset = presetById(GRAPHIFY_PRESETS, presetId);
  if (!preset) return NextResponse.json({ error: `неизвестный пресет: ${presetId}` }, { status: 400 });
  const apiKey = str(body?.apiKey, 256);
  const modelId = str(body?.modelId, 128);
  ctx.state.graphifyLlm = { preset: preset.id, apiKey, modelId };
  await ctx.saveState();
  return NextResponse.json({ ok: true, llm: { preset: preset.id, apiKey, modelId } });
}
