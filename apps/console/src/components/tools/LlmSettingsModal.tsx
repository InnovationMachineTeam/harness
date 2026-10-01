"use client";

import { useEffect, useState } from "react";
import type { LlmPreset } from "@/core/llmPresets";
import { Button, Input, Modal, Notice, Select } from "@/ui/UIKit";

export interface LlmSettingsValue {
  preset: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

/**
 * Модалка LLM-настроек инструмента: пресет провайдера, ключ, base URL
 * (для OpenAI-совместимых) и модель. Сохранение - через переданный onSave.
 */
export function LlmSettingsModal({
  open,
  onClose,
  title,
  description,
  presets,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  presets: LlmPreset[];
  initial: LlmSettingsValue;
  onSave: (value: LlmSettingsValue) => Promise<string | null>;
}) {
  const [value, setValue] = useState<LlmSettingsValue>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);

  const preset = presets.find((p) => p.id === value.preset) ?? presets[0];

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
