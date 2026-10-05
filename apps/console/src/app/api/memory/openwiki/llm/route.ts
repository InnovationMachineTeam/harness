import { NextResponse } from "next/server";
import { openwikiLlmConfig } from "@/core/openwikiLlm";
import { presetById, OPENWIKI_PRESETS } from "@/core/llmPresets";
import { isActiveProvider, providerPresetById } from "@/core/providers";
import { readProviderEntry } from "@/core/providerSettings";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/memory/openwiki/llm - LLM-провайдер сборки OpenWiki
 * (state.openwikiLlm; env-переменные передаются в openwiki CLI при сборке
 * и в промпт "через runtime"). Ключ хранится локально в state.json (вне git).
 * PUT с providerId (и без полей) выводит пресет/ключ/base URL/модель из записи
 * активного провайдера реестра (вкладка "Провайдеры").
 */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json({ llm: openwikiLlmConfig(ctx.state) });
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
  const providerId = str(body?.providerId, 64) || undefined;

  if (providerId) {
    const provider = providerPresetById(providerId);
    const entry = provider
      ? await readProviderEntry(ctx.repoRoot, provider, ctx.state.providers.entries[providerId] ?? null)
      : undefined;
    const openwikiPresetId = provider?.tools.openwiki;
    if (!provider || !openwikiPresetId || !presetById(OPENWIKI_PRESETS, openwikiPresetId)) {
      return NextResponse.json({ error: `провайдер не поддерживает OpenWiki: ${providerId}` }, { status: 400 });
    }
    if (!isActiveProvider(provider, entry)) {
      return NextResponse.json(
        { error: `провайдер ${provider.label} не активен - заполните поля и пройдите проверку` },
        { status: 400 },
      );
    }
    ctx.state.openwikiLlm = {
      preset: openwikiPresetId,
      apiKey: entry!.apiKey,
      baseUrl: entry!.baseUrl,
      modelId: entry!.models.standard,
      providerId,
    };
    await ctx.saveState();
    return NextResponse.json({ ok: true, llm: openwikiLlmConfig(ctx.state) });
  }

  const presetId = str(body?.preset, 64) || "openai-compatible";
  const preset = presetById(OPENWIKI_PRESETS, presetId);
  if (!preset) return NextResponse.json({ error: `неизвестный пресет: ${presetId}` }, { status: 400 });
  const apiKey = str(body?.apiKey, 256);
  const baseUrl = str(body?.baseUrl, 256);
  const modelId = str(body?.modelId, 128);
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ error: "baseUrl: только http(s)" }, { status: 400 });
  }
  ctx.state.openwikiLlm = { preset: preset.id, apiKey, baseUrl, modelId };
  await ctx.saveState();
  return NextResponse.json({ ok: true, llm: { preset: preset.id, apiKey, baseUrl, modelId } });
}
