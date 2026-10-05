import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConsoleState } from "./state";
import {
  emptyProviderEntry,
  MODEL_TIERS,
  PROVIDER_PRESETS,
  providerPresetById,
  type ModelTier,
  type ProviderEntry,
  type ProviderPreset,
  type ProviderVerification,
} from "./providers";

/**
 * Изменяемые настройки провайдеров - файлы в .agents/providers/<id>/:
 *  - settings.json - base URL, модели tiers, scope обмена (попадает в git);
 *  - key.env       - ключ доступа в форме "<ENV>=<значение>" (вне git);
 *  - ca.pem        - сертификат CA, загруженный файлом и переименованный
 *                    под стандартное имя (вне git); запросы провайдера всегда
 *                    читают этот путь.
 * Результат проверки (verifiedAt/verifyError/verifyModels) - машинное
 * состояние, остаётся в .agents/console/state.json. ProviderEntry для UI и
 * запросов собирается из файлов и результата проверки (readProviderEntry).
 */

const CERT_MAX_BYTES = 64 * 1024;

export function providerDir(repoRoot: string, id: string): string {
  return path.join(repoRoot, ".agents", "providers", id);
}

export function providerSettingsFile(repoRoot: string, id: string): string {
  return path.join(providerDir(repoRoot, id), "settings.json");
}

export function providerKeyFile(repoRoot: string, id: string): string {
  return path.join(providerDir(repoRoot, id), "key.env");
}

export function providerCertFile(repoRoot: string, id: string): string {
  return path.join(providerDir(repoRoot, id), "ca.pem");
}

export function providerCertPresent(repoRoot: string, id: string): boolean {
  return existsSync(providerCertFile(repoRoot, id));
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/* ------------------------------ settings.json ------------------------------ */

export interface ProviderSettingsData {
  baseUrl?: string;
  models?: Partial<Record<ModelTier, string>>;
  authScope?: string;
  pricing?: Record<string, { inputPerMillion?: number; outputPerMillion?: number; cachePerMillion?: number; currency: string; source?: string; asOf?: string; verified?: boolean }>;
}

async function readSettingsData(repoRoot: string, id: string): Promise<ProviderSettingsData> {
  try {
    return JSON.parse(await readFile(providerSettingsFile(repoRoot, id), "utf8")) as ProviderSettingsData;
  } catch {
    return {};
  }
}

/** Записать settings.json (перезапись целиком, атомарно). */
export async function writeProviderSettings(repoRoot: string, id: string, data: ProviderSettingsData): Promise<void> {
  const current = await readSettingsData(repoRoot, id);
  await atomicWrite(providerSettingsFile(repoRoot, id), `${JSON.stringify({ ...current, ...data }, null, 2)}\n`);
}

/* --------------------------------- key.env --------------------------------- */

/** Ключ доступа: первая строка "ENV=значение" из key.env; пустая строка - файла нет. */
export async function readProviderKey(repoRoot: string, id: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(providerKeyFile(repoRoot, id), "utf8");
  } catch {
    return "";
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    return eq >= 0 ? trimmed.slice(eq + 1).trim() : trimmed;
  }
  return "";
}

/** Записать key.env одной строкой "<ENV>=<значение>" (ENV - из пресета). */
export async function writeProviderKey(repoRoot: string, preset: ProviderPreset, apiKey: string): Promise<void> {
  const envName = preset.apiKeyEnv ?? "API_KEY";
  await atomicWrite(providerKeyFile(repoRoot, preset.id), `${envName}=${apiKey}\n`);
}

/* ---------------------------------- ca.pem --------------------------------- */

/**
 * Сохранить сертификат под стандартным именем ca.pem (загруженный файл
 * переименовывается). Возвращает текст ошибки или null при успехе.
 */
export async function writeProviderCert(repoRoot: string, id: string, pem: string): Promise<string | null> {
  if (Buffer.byteLength(pem, "utf8") > CERT_MAX_BYTES) {
    return "сертификат слишком большой (более 64 КБ)";
  }
  if (!pem.includes("BEGIN CERTIFICATE")) {
    return "файл не содержит PEM-сертификат (нужен блок BEGIN CERTIFICATE)";
  }
  await atomicWrite(providerCertFile(repoRoot, id), pem.endsWith("\n") ? pem : `${pem}\n`);
  return null;
}

/** PEM-содержимое сертификата провайдера; null - файла нет. */
export function readProviderCert(repoRoot: string, id: string): string | null {
  try {
    return readFileSync(providerCertFile(repoRoot, id), "utf8");
  } catch {
    return null;
  }
}

export async function removeProviderCert(repoRoot: string, id: string): Promise<void> {
  await unlink(providerCertFile(repoRoot, id)).catch(() => undefined);
}

/** Удалить известные файлы настроек провайдера (без удаления каталога). */
export async function clearProviderFiles(repoRoot: string, id: string): Promise<void> {
  const dir = providerDir(repoRoot, id);
  if (!existsSync(dir)) return;
  await unlink(providerSettingsFile(repoRoot, id)).catch(() => undefined);
  await unlink(providerKeyFile(repoRoot, id)).catch(() => undefined);
  await unlink(providerCertFile(repoRoot, id)).catch(() => undefined);
}

/* ---------------------------- сборка записи провайдера ---------------------------- */

/**
 * Собранная запись провайдера: файлы настроек (недостающее - из пресета) +
 * результат проверки из state.json. Все серверные потребители (роуты,
 * providerRun) читают запись только через эту функцию.
 */
export async function readProviderEntry(
  repoRoot: string,
  preset: ProviderPreset,
  verification?: ProviderVerification | null,
): Promise<ProviderEntry> {
  const base = emptyProviderEntry(preset);
  const settings = await readSettingsData(repoRoot, preset.id);
  const models = {} as Record<ModelTier, string>;
  for (const tier of MODEL_TIERS) {
    models[tier] = settings.models?.[tier]?.trim() || base.models[tier];
  }
  return {
    apiKey: await readProviderKey(repoRoot, preset.id),
    baseUrl: settings.baseUrl?.trim() || base.baseUrl,
    models,
    authScope: settings.authScope?.trim() || base.authScope,
    caFile: providerCertPresent(repoRoot, preset.id) ? providerCertFile(repoRoot, preset.id) : undefined,
    verifiedAt: verification?.verifiedAt ?? null,
    verifyError: verification?.verifyError ?? null,
    verifyModels: verification?.verifyModels ?? [],
  };
}

/* --------------------- базовые настройки всех пресетов --------------------- */

/**
 * Базовые настройки каждого пресета пишутся в .agents/providers/<id>/
 * settings.json (baseUrl, модели tiers, scope по умолчанию) - карточки
 * провайдеров подставляют значения из этих файлов. Существующий файл не
 * перезаписывается. Возвращает число созданных файлов.
 */
export async function ensureProviderBaseSettings(repoRoot: string): Promise<number> {
  let created = 0;
  for (const preset of PROVIDER_PRESETS) {
    if (existsSync(providerSettingsFile(repoRoot, preset.id))) continue;
    await writeProviderSettings(repoRoot, preset.id, {
      baseUrl: preset.baseUrl,
      models: { ...preset.models },
      authScope: preset.auth?.scopeDefault,
    });
    created += 1;
  }
  return created;
}

/* ------------------------------- миграция из state ------------------------------- */

const LEGACY_FIELDS = ["apiKey", "baseUrl", "models", "authScope", "caFile"] as const;

/**
 * Миграция записей старого формата (все поля в state.json) в файлы
 * .agents/providers/<id>/: настройки и ключ пишутся только если файлов ещё
 * нет; после миграции в state.json остаются только поля проверки. Возвращает
 * true, если state изменён и требует сохранения.
 */
export async function migrateProviderEntries(repoRoot: string, state: ConsoleState): Promise<boolean> {
  let changed = false;
  for (const [id, raw] of Object.entries(state.providers.entries)) {
    const legacy = raw as unknown as Partial<ProviderEntry> & ProviderVerification;
    const hasLegacy = LEGACY_FIELDS.some((field) => field in legacy);
    const preset = providerPresetById(id);
    if (hasLegacy && preset) {
      if (!existsSync(providerSettingsFile(repoRoot, id))) {
        await writeProviderSettings(repoRoot, id, {
          baseUrl: legacy.baseUrl,
          models: legacy.models,
          authScope: legacy.authScope,
        });
      }
      if (preset.apiKeyEnv && legacy.apiKey && !existsSync(providerKeyFile(repoRoot, id))) {
        await writeProviderKey(repoRoot, preset, legacy.apiKey);
      }
      if (legacy.caFile) {
        try {
          const pem = readFileSync(legacy.caFile, "utf8");
          if (pem.includes("BEGIN CERTIFICATE") && !providerCertPresent(repoRoot, id)) {
            await writeProviderCert(repoRoot, id, pem);
          }
        } catch {
          /* недоступный путь сертификата пропускается */
        }
      }
    }
    if (hasLegacy) {
      state.providers.entries[id] = {
        verifiedAt: legacy.verifiedAt ?? null,
        verifyError: legacy.verifyError ?? null,
        verifyModels: Array.isArray(legacy.verifyModels) ? legacy.verifyModels : [],
      };
      changed = true;
    }
  }
  return changed;
}
