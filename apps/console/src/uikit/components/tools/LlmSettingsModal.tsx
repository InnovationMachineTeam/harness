"use client";

import { useEffect, useState } from "react";
import type { LlmPreset } from "@/core/llmPresets";
import type { ProviderDTO } from "@/core/providers";
import { useActiveProviders } from "@/uikit/components/providers/useActiveProviders";
import { Button, Input, Modal, Notice, Select } from "@/uikit";

export interface LlmSettingsValue {
  preset: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  /** Провайдер реестра, из которого заполнены поля (пометка интеграции). */
  providerId?: string;
}

/**
 * Модалка LLM-настроек инструмента: выбор провайдера из реестра консоли
 * (заполняет поля значениями проверенного провайдера), пресет, ключ, base URL
 * (для OpenAI-совместимых) и модель. Сохранение - через переданный onSave.
 */
export function LlmSettingsModal({
  open,
  onClose,
  title,
  description,
  presets,
  initial,
  toolKey,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  presets: LlmPreset[];
  initial: LlmSettingsValue;
  /** Маппинг провайдеров на пресеты инструмента ("openwiki" | "graphify"). */
  toolKey?: "openwiki" | "graphify";
  onSave: (value: LlmSettingsValue) => Promise<string | null>;
}) {
  const [value, setValue] = useState<LlmSettingsValue>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useActiveProviders(toolKey);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);

  const preset = presets.find((p) => p.id === value.preset) ?? presets[0];

  const applyProvider = (providerId: string) => {
    if (!providerId) {
      setValue((v) => ({ ...v, providerId: undefined }));
      return;
    }
    const provider = providers.find((p) => p.id === providerId);
    const presetId = provider?.tools[toolKey ?? "openwiki"];
    if (!provider || !presetId) return;
    setValue((v) => ({
      ...v,
      providerId,
      preset: presetId,
      apiKey: provider.entry?.apiKey ?? "",
      baseUrl: toolKey === "openwiki" ? (provider.entry?.baseUrl ?? "") : v.baseUrl,
      modelId: provider.entry?.models.standard ?? v.modelId,
    }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await onSave(value);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} width="max-w-xl">
      <div className="space-y-3">
        {toolKey ? (
          <div>
            <p className="mb-1 text-[11px] text-fg-faint">Провайдер из реестра (проверенные)</p>
            <Select
              value={value.providerId ?? ""}
              onChange={applyProvider}
              options={[
                { value: "", label: "вручную (ниже)" },
                ...providers.map((p) => ({ value: p.id, label: p.label })),
              ]}
              ariaLabel="провайдер из реестра"
            />
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-[11px] text-fg-faint">Пресет</p>
          <Select
            value={value.preset}
            onChange={(id) => {
              const next = presets.find((p) => p.id === id);
              setValue((v) => ({ ...v, preset: id, baseUrl: next?.needsBaseUrl ? v.baseUrl : "" }));
            }}
            options={presets.map((p) => ({ value: p.id, label: p.label }))}
            ariaLabel="LLM-пресет"
          />
        </div>
        {preset.apiKeyEnv ? (
          <div>
            <p className="mb-1 text-[11px] text-fg-faint">
              API-ключ (env <span className="font-mono">{preset.apiKeyEnv}</span>)
            </p>
            <Input
              size="form"
              type="password"
              value={value.apiKey}
              onChange={(e) => setValue((v) => ({ ...v, apiKey: e.target.value }))}
              placeholder={preset.id === "openai-compatible" ? "ollama" : "ключ провайдера"}
              className="w-full font-mono"
              aria-label="API-ключ"
            />
          </div>
        ) : null}
        {preset.needsBaseUrl ? (
          <div>
            <p className="mb-1 text-[11px] text-fg-faint">Base URL</p>
            <Input
              size="form"
              value={value.baseUrl}
              onChange={(e) => setValue((v) => ({ ...v, baseUrl: e.target.value }))}
              placeholder="http://localhost:11434/v1"
              className="w-full font-mono"
              aria-label="Base URL"
            />
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-[11px] text-fg-faint">Модель</p>
          <Input
            size="form"
            value={value.modelId}
            onChange={(e) => setValue((v) => ({ ...v, modelId: e.target.value }))}
            placeholder="например, gpt-5.6-terra / kimi-k3:cloud"
            className="w-full font-mono"
            aria-label="модель"
          />
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="accent" disabled={busy} onClick={() => void save()}>
            {busy ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
