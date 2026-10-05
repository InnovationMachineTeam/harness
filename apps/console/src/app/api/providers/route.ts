import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import {
  isActiveProvider,
  langgraphEnvFile,
  langgraphSupported,
  MODEL_TIERS,
  PROVIDER_PRESETS,
  providerBaseUrlError,
  providerComplete,
  providerPresetById,
  providerStatus,
  taskProviderId,
  verifyProvider,
  type ModelTier,
  type ProviderDTO,
  type ProviderEntry,
  type ProviderPreset,
  type ProviderVerification,
} from "@/core/providers";
import { withProviderAuth } from "@/core/providerAuth";
import { checkLocalProvider } from "@/core/providerLocal";
import {
  clearProviderFiles,
  providerCertPresent,
  readProviderEntry,
  removeProviderCert,
  writeProviderCert,
  writeProviderKey,
  writeProviderSettings,
} from "@/core/providerSettings";
import type { TaskKind } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Строка с ограничением длины; не-строки - пустая строка. */
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function emptyVerification(): ProviderVerification {
  return { verifiedAt: null, verifyError: null, verifyModels: [] };
}

/** TTL кеша живости локальных сервисов: реестр опрашивается при каждом монтировании страниц. */
const LOCAL_CHECK_TTL_MS = 30_000;
const localCheckCache = new Map<string, { at: number; value: { installed: boolean; running: boolean } }>();

/** Проверка живости локального сервиса с кешем: страницы не дёргают локальные адреса при каждом открытии. */
async function checkLocalProviderCached(preset: ProviderPreset, baseUrl: string): Promise<{ installed: boolean; running: boolean }> {
  const cached = localCheckCache.get(preset.id);
  if (cached && Date.now() - cached.at < LOCAL_CHECK_TTL_MS) return cached.value;
  const value = await checkLocalProvider(preset, baseUrl);
  localCheckCache.set(preset.id, { at: Date.now(), value });
  return value;
}

function dto(
  id: string,
  ctx: Awaited<ReturnType<typeof serverContext>>,
  entry: ProviderEntry | null,
  local: { installed: boolean; running: boolean } | undefined,
): ProviderDTO | null {
  const preset = providerPresetById(id);
  if (!preset) return null;
  const tasks = (Object.keys(ctx.state.settings.taskRuntimes) as TaskKind[]).filter(
    (task) => ctx.state.settings.taskRuntimes[task] === taskProviderId(id),
  );
  return {
    id: preset.id,
    label: preset.label,
    kind: preset.kind,
    apiKeyEnv: preset.apiKeyEnv,
    baseUrl: preset.baseUrl,
    docsUrl: preset.docsUrl,
    presetModels: { ...preset.models },
    auth: preset.auth
      ? { kind: "oauth2", scopeDefault: preset.auth.scopeDefault, scopeOptions: preset.auth.scopeOptions, hint: preset.auth.hint }
      : null,
    certPresent: providerCertPresent(ctx.repoRoot, id),
    certRequired: preset.cert?.required ?? false,
    certHint: preset.cert?.hint,
    langgraphSupported: langgraphSupported(preset),
    tools: preset.tools,
    entry,
    status: providerStatus(preset, entry, local),
    local: preset.local ? local : undefined,
    integrations: {
      openwiki: ctx.state.openwikiLlm?.providerId === id,
      graphify: ctx.state.graphifyLlm?.providerId === id,
      langgraph: ctx.state.providers.langgraphExport?.providerId === id,
    },
    tasks,
    langgraphExportedAt: ctx.state.providers.langgraphExport?.providerId === id
      ? ctx.state.providers.langgraphExport.at
      : null,
  };
}

/** GET /api/providers - реестр провайдеров: пресеты, собранные записи, статусы, локальные сервисы, интеграции. */
export async function GET() {
  const ctx = await serverContext();
  // локальные сервисы проверяются параллельно (existsSync + один запрос, таймаут 1.5 с, кеш 30 с)
  const localStates = new Map<string, { installed: boolean; running: boolean }>();
  await Promise.all(
    PROVIDER_PRESETS.map(async (preset) => {
      if (!preset.local) return;
      const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[preset.id] ?? null);
      localStates.set(preset.id, await checkLocalProviderCached(preset, entry.baseUrl));
    }),
  );
  const providers: ProviderDTO[] = [];
  for (const preset of PROVIDER_PRESETS) {
    const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[preset.id] ?? null);
    const card = dto(preset.id, ctx, entry, localStates.get(preset.id));
    if (card) providers.push(card);
  }
  return NextResponse.json({
    providers,
    langgraph: {
      file: path.join(ctx.repoRoot, ".agents", "console", "langgraph.env"),
      export: ctx.state.providers.langgraphExport,
    },
  });
}

/** PUT /api/providers {id, apiKey, baseUrl, models, authScope?} - сохранить настройки в .agents/providers/<id>/. */
export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; apiKey?: unknown; baseUrl?: unknown; models?: unknown; authScope?: unknown }
    | null;
  const preset = providerPresetById(str(body?.id, 64));
  if (!preset) return NextResponse.json({ error: "неизвестный провайдер" }, { status: 400 });

  const apiKey = str(body?.apiKey, 256);
  const baseUrl = str(body?.baseUrl, 256) || preset.baseUrl;
  const baseUrlError = providerBaseUrlError(baseUrl, preset.kind);
  if (baseUrlError) return NextResponse.json({ error: baseUrlError }, { status: 400 });

  const rawModels = (body?.models ?? {}) as Record<string, unknown>;
  const models = {} as Record<ModelTier, string>;
  for (const tier of MODEL_TIERS) {
    models[tier] = str(rawModels[tier], 128);
  }
  const authScope = preset.auth ? str(body?.authScope, 64) || preset.auth.scopeDefault : undefined;
  if (authScope && preset.auth && !preset.auth.scopeOptions.includes(authScope)) {
    return NextResponse.json({ error: `недопустимый scope: ${authScope}` }, { status: 400 });
  }

  const current = await readProviderEntry(ctx.repoRoot, preset, null);
  const changed =
    current.apiKey !== apiKey ||
    current.baseUrl !== baseUrl ||
    (current.authScope ?? "") !== (authScope ?? "") ||
    MODEL_TIERS.some((tier) => current.models[tier] !== models[tier]);
  if (changed) {
    // настройки - файлами (.agents/providers/<id>/), изменение сбрасывает проверку
    await writeProviderSettings(ctx.repoRoot, preset.id, {
      baseUrl,
      models,
      authScope: preset.auth ? authScope : undefined,
    });
    if (preset.apiKeyEnv) {
      await writeProviderKey(ctx.repoRoot, preset, apiKey);
    }
    ctx.state.providers.entries[preset.id] = emptyVerification();
    await ctx.saveState();
    invalidateDashboardCache();
  }
  const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[preset.id] ?? null);
  const local = preset.local ? await checkLocalProvider(preset, entry.baseUrl) : undefined;
  return NextResponse.json({ ok: true, provider: dto(preset.id, ctx, entry, local) });
}

/**
 * POST /api/providers {id, action}: verify - проверка; upload-cert/remove-cert -
 * сертификат CA (стандартное имя ca.pem в папке провайдера); export-langgraph;
 * clear - удалить настройки и результат проверки.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; action?: unknown; content?: unknown }
    | null;
  const id = str(body?.id, 64);
  const preset = providerPresetById(id);
  if (!preset) return NextResponse.json({ error: "неизвестный провайдер" }, { status: 400 });
  const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[id] ?? null);

  if (body?.action === "verify") {
    if (!entry || !providerComplete(preset, entry)) {
      return NextResponse.json({ error: "провайдер не заполнен - заполните все поля" }, { status: 400 });
    }
    const local = await checkLocalProvider(preset, entry.baseUrl);
    if (!local.installed) {
      return NextResponse.json(
        { error: `локальный сервис не установлен - установите ${preset.local?.binaries.join(" / ")}` },
        { status: 400 },
      );
    }
    if (!local.running) {
      return NextResponse.json(
        { error: "локальный сервис не запущен - запустите его и повторите проверку" },
        { status: 400 },
      );
    }
    // токен: статический ключ или обменянный access-токен (oauth2); после HTTP 401
    // у oauth2-провайдера обмен повторяется один раз
    const authOutcome = await withProviderAuth(
      preset,
      entry,
      (auth) => verifyProvider(preset, entry, auth.fetch, auth.token),
      (result) => result.httpStatus === 401,
    );
    const result = authOutcome.ok
      ? authOutcome.value
      : { ok: false, error: authOutcome.error, models: [] as string[], httpStatus: null as number | null };
    ctx.state.providers.entries[id] = {
      verifiedAt: result.ok ? new Date().toISOString() : null,
      verifyError: result.error,
      verifyModels: result.models,
    };
    await ctx.saveState();
    invalidateDashboardCache();
    return NextResponse.json({
      ok: result.ok,
      error: result.error,
      models: result.models,
      provider: dto(id, ctx, entry, local),
    });
  }

  if (body?.action === "upload-cert") {
    if (!preset.cert) {
      return NextResponse.json({ error: "провайдер не поддерживает сертификат CA" }, { status: 400 });
    }
    const content = typeof body?.content === "string" ? body.content.slice(0, 128 * 1024) : "";
    if (!content.trim()) {
      return NextResponse.json({ error: "файл сертификата пуст" }, { status: 400 });
    }
    const certError = await writeProviderCert(ctx.repoRoot, id, content);
    if (certError) return NextResponse.json({ error: certError }, { status: 400 });
    // смена сертификата обесценивает прошлую проверку
    ctx.state.providers.entries[id] = emptyVerification();
    await ctx.saveState();
    invalidateDashboardCache();
    const fresh = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[id] ?? null);
    const local = preset.local ? await checkLocalProvider(preset, fresh.baseUrl) : undefined;
    return NextResponse.json({ ok: true, provider: dto(id, ctx, fresh, local) });
  }

  if (body?.action === "remove-cert") {
    if (!preset.cert) {
      return NextResponse.json({ error: "провайдер не поддерживает сертификат CA" }, { status: 400 });
    }
    await removeProviderCert(ctx.repoRoot, id);
    ctx.state.providers.entries[id] = emptyVerification();
    await ctx.saveState();
    invalidateDashboardCache();
    const fresh = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[id] ?? null);
    const local = preset.local ? await checkLocalProvider(preset, fresh.baseUrl) : undefined;
    return NextResponse.json({ ok: true, provider: dto(id, ctx, fresh, local) });
  }

  if (body?.action === "export-langgraph") {
    if (!entry || !isActiveProvider(preset, entry)) {
      return NextResponse.json({ error: "экспорт доступен активному провайдеру - сначала пройдите проверку" }, { status: 400 });
    }
    if (!langgraphSupported(preset)) {
      return NextResponse.json(
        { error: "экспорт не поддерживается: провайдер с OAuth 2.0 - получатель .env не сможет обменять ключ на токен" },
        { status: 400 },
      );
    }
    const file = path.join(ctx.repoRoot, ".agents", "console", "langgraph.env");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, langgraphEnvFile(preset, entry), "utf8");
    ctx.state.providers.langgraphExport = { providerId: id, at: new Date().toISOString() };
    await ctx.saveState();
    const local = preset.local ? await checkLocalProvider(preset, entry.baseUrl) : undefined;
    return NextResponse.json({ ok: true, file, provider: dto(id, ctx, entry, local) });
  }

  if (body?.action === "clear") {
    // файлы настроек + результат проверки удаляются; привязки инструментов снимаются
    await clearProviderFiles(ctx.repoRoot, id);
    delete ctx.state.providers.entries[id];
    if (ctx.state.providers.langgraphExport?.providerId === id) {
      ctx.state.providers.langgraphExport = null;
    }
    if (ctx.state.openwikiLlm?.providerId === id) {
      ctx.state.openwikiLlm = { ...ctx.state.openwikiLlm, providerId: undefined };
    }
    if (ctx.state.graphifyLlm?.providerId === id) {
      ctx.state.graphifyLlm = { ...ctx.state.graphifyLlm, providerId: undefined };
    }
    await ctx.saveState();
    invalidateDashboardCache();
    const local = preset.local ? await checkLocalProvider(preset, preset.baseUrl) : undefined;
    return NextResponse.json({ ok: true, provider: dto(id, ctx, null, local) });
  }

  return NextResponse.json(
    { error: "действие не поддерживается: verify | upload-cert | remove-cert | export-langgraph | clear" },
    { status: 400 },
  );
}
