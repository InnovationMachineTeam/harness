import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState, loadConsoleState, saveConsoleState, stateFilePath } from "@/core/state";
import {
  clearProviderFiles,
  ensureProviderBaseSettings,
  migrateProviderEntries,
  providerCertFile,
  providerCertPresent,
  providerKeyFile,
  providerSettingsFile,
  readProviderEntry,
  readProviderKey,
  removeProviderCert,
  writeProviderCert,
  writeProviderKey,
  writeProviderSettings,
} from "@/core/providerSettings";
import { emptyProviderEntry, PROVIDER_PRESETS, providerPresetById } from "@/core/providers";

const gigachat = providerPresetById("gigachat")!;
const openai = providerPresetById("openai")!;

/** Фиктивные значения ключей для тестов (не секреты). */
const TEST_KEY = "sk-test";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

let repo = "";

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "provider-settings-"));
});

afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

describe("settings.json и key.env", () => {
  test("запись и чтение: ключ из key.env, настройки из settings.json", async () => {
    await writeProviderSettings(repo, gigachat.id, {
      baseUrl: "https://api.giga.chat/v1",
      models: { fast: "GigaChat-2-Lite", standard: "GigaChat-2-Pro", strong: "GigaChat-2-Max", subagents: "GigaChat-2-Lite" },
      authScope: "GIGACHAT_API_B2B",
    });
    await writeProviderKey(repo, gigachat, TEST_KEY);
    expect(await readProviderKey(repo, gigachat.id)).toBe(TEST_KEY);
    const raw = JSON.parse(await readFile(providerSettingsFile(repo, gigachat.id), "utf8"));
    expect(raw.baseUrl).toBe("https://api.giga.chat/v1");
    expect(raw.authScope).toBe("GIGACHAT_API_B2B");
    const keyRaw = await readFile(providerKeyFile(repo, gigachat.id), "utf8");
    expect(keyRaw.trim()).toBe(`GIGACHAT_AUTH_KEY=${TEST_KEY}`);
  });

  test("без файлов запись собирается из пресета; verification подставляется из state", async () => {
    const entry = await readProviderEntry(repo, openai, { verifiedAt: "2026-10-01T00:00:00Z", verifyError: null, verifyModels: ["gpt-5"] });
    const preset = emptyProviderEntry(openai);
    expect(entry.apiKey).toBe("");
    expect(entry.baseUrl).toBe(preset.baseUrl);
    expect(entry.models).toEqual(preset.models);
    expect(entry.verifiedAt).toBe("2026-10-01T00:00:00Z");
    expect(entry.verifyModels).toEqual(["gpt-5"]);
    expect(entry.caFile).toBeUndefined();
  });

  test("файлы настроек перекрывают пресет; сертификат даёт стандартный путь", async () => {
    await writeProviderSettings(repo, gigachat.id, {
      baseUrl: "https://custom.example/v1",
      models: { standard: "GigaChat-2-Max" },
    });
    await writeProviderCert(repo, gigachat.id, PEM);
    const entry = await readProviderEntry(repo, gigachat, null);
    expect(entry.baseUrl).toBe("https://custom.example/v1");
    expect(entry.models.standard).toBe("GigaChat-2-Max");
    // недостающие tiers - из пресета
    expect(entry.models.fast).toBe(gigachat.models.fast);
    expect(entry.caFile).toBe(providerCertFile(repo, gigachat.id));
  });
});

describe("сертификат ca.pem", () => {
  test("не-PEM содержимое отклоняется", async () => {
    const error = await writeProviderCert(repo, openai.id, "это не сертификат");
    expect(error).toContain("PEM");
    expect(providerCertPresent(repo, openai.id)).toBe(false);
  });

  test("удаление сертификата снимает стандартный путь", async () => {
    expect(providerCertPresent(repo, gigachat.id)).toBe(true);
    await removeProviderCert(repo, gigachat.id);
    expect(providerCertPresent(repo, gigachat.id)).toBe(false);
    const entry = await readProviderEntry(repo, gigachat, null);
    expect(entry.caFile).toBeUndefined();
  });
});

describe("clearProviderFiles", () => {
  test("удаляет settings.json, key.env и ca.pem", async () => {
    await writeProviderSettings(repo, openai.id, { baseUrl: "https://api.openai.com/v1" });
    await writeProviderKey(repo, openai, TEST_KEY);
    await writeProviderCert(repo, openai.id, PEM);
    await clearProviderFiles(repo, openai.id);
    expect(providerCertPresent(repo, openai.id)).toBe(false);
    expect(await readProviderKey(repo, openai.id)).toBe("");
    const entry = await readProviderEntry(repo, openai, null);
    expect(entry.baseUrl).toBe("https://api.openai.com/v1"); // снова значение пресета
  });
});

describe("ensureProviderBaseSettings", () => {
  test("создаёт settings.json всех пресетов с базовыми значениями; существующие не трогает", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-seed-"));
    try {
      // пользовательское значение до посева должно сохраниться
      await writeProviderSettings(root, gigachat.id, { baseUrl: "https://custom.example/v1" });
      const created = await ensureProviderBaseSettings(root);
      expect(created).toBe(PROVIDER_PRESETS.length - 1);
      // повторный вызов ничего не создаёт
      expect(await ensureProviderBaseSettings(root)).toBe(0);
      // пользовательский файл не перезаписан
      const gigachatEntry = await readProviderEntry(root, gigachat, null);
      expect(gigachatEntry.baseUrl).toBe("https://custom.example/v1");
      // у остальных - базовые значения пресета, доступные карточкам
      const yandexgpt = providerPresetById("yandexgpt")!;
      const entry = await readProviderEntry(root, yandexgpt, null);
      expect(entry.baseUrl).toBe(yandexgpt.baseUrl);
      expect(entry.models).toEqual(yandexgpt.models);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("migrateProviderEntries", () => {
  test("запись старого формата переносится в файлы; в state остаются поля проверки", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-migrate-"));
    try {
      const legacyCa = join(root, "old-ca.pem");
      await writeFile(legacyCa, PEM, "utf8");
      const state = defaultState(root);
      state.providers.entries.gigachat = {
        apiKey: TEST_KEY,
        baseUrl: "https://api.giga.chat/v1",
        models: { ...gigachat.models },
        authScope: "GIGACHAT_API_CORP",
        caFile: legacyCa,
        verifiedAt: "2026-10-01T00:00:00Z",
        verifyError: null,
        verifyModels: ["GigaChat-2-Max"],
      } as never;
      const changed = await migrateProviderEntries(root, state);
      expect(changed).toBe(true);
      expect(await readProviderKey(root, gigachat.id)).toBe(TEST_KEY);
      expect(providerCertPresent(root, gigachat.id)).toBe(true);
      expect(state.providers.entries.gigachat).toEqual({
        verifiedAt: "2026-10-01T00:00:00Z",
        verifyError: null,
        verifyModels: ["GigaChat-2-Max"],
      });
      // повторная миграция ничего не меняет
      expect(await migrateProviderEntries(root, state)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("провайдер без пресета не падает и не переносится", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-migrate-unknown-"));
    try {
      await mkdir(join(root, ".agents"), { recursive: true });
      const state = defaultState(root);
      state.providers.entries.unknown = { verifiedAt: null, verifyError: "x", verifyModels: [] };
      expect(await migrateProviderEntries(root, state)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("связка load-migrate-save: старая запись на диске переносится в файлы", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-load-migrate-"));
    try {
      await mkdir(join(root, ".agents", "console"), { recursive: true });
      const state = defaultState(root);
      state.providers.entries.gigachat = {
        apiKey: TEST_KEY,
        baseUrl: "https://api.giga.chat/v1",
        models: { ...gigachat.models },
        verifiedAt: "2026-10-01T00:00:00Z",
        verifyError: null,
        verifyModels: [],
      } as never;
      await saveConsoleState(root, state);
      // загрузка не обрезает старые поля - их видит миграция
      const loaded = await loadConsoleState(root);
      expect("apiKey" in (loaded.providers.entries.gigachat as object)).toBe(true);
      expect(await migrateProviderEntries(root, loaded)).toBe(true);
      await saveConsoleState(root, loaded);
      // значения теперь в файлах, state хранит только проверку
      expect(await readProviderKey(root, gigachat.id)).toBe(TEST_KEY);
      const reloaded = await loadConsoleState(root);
      expect(reloaded.providers.entries.gigachat).toEqual({
        verifiedAt: "2026-10-01T00:00:00Z",
        verifyError: null,
        verifyModels: [],
      });
      expect(await readFile(stateFilePath(root), "utf8")).toContain("verifiedAt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
