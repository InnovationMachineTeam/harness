"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProviderCard } from "@/uikit/components/providers/ProviderCard";
import type { ProviderDTO } from "@/core/providers";
import { FALLBACK_PROVIDER_ID } from "@/core/providers";
import { useConsoleStore } from "@/store/console";
import { Button, Input, Modal, Panel, Select } from "@/uikit";

/**
 * Панель "AI SDK" (Настройки → Основные): провайдер AI SDK по умолчанию для
 * вкладки "Агент", лимит реплик истории direct-чата и установка провайдера -
 * модал с выбором пресета и карточкой заполнения (ключ, base URL, модели,
 * проверка). Значения хранятся в state.json (defaultProvider,
 * agentHistoryLimit); пустой провайдер - действует Ollama, пустой лимит - 20.
 */
export function AiSdkPanel() {
  const defaultProvider = useConsoleStore((s) => s.defaultProvider);
  const setDefaultProvider = useConsoleStore((s) => s.setDefaultProvider);
  const agentHistoryLimit = useConsoleStore((s) => s.agentHistoryLimit);
  const setAgentHistoryLimit = useConsoleStore((s) => s.setAgentHistoryLimit);
  const [providers, setProviders] = useState<ProviderDTO[] | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installId, setInstallId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [historyDraft, setHistoryDraft] = useState<string>("");
  const [historyError, setHistoryError] = useState<string | null>(null);

  // черновик поля следует за серверным значением (null - по умолчанию 20)
  useEffect(() => {
    setHistoryDraft(agentHistoryLimit === null ? "" : String(agentHistoryLimit));
  }, [agentHistoryLimit]);

  const saveHistoryLimit = async () => {
    const trimmed = historyDraft.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 500)) {
      setHistoryError("целое число от 0 до 500; пусто - по умолчанию 20");
      return;
    }
    const ok = await setAgentHistoryLimit(parsed);
    if (ok) setHistoryError(null);
    else setHistoryError("не удалось сохранить");
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { providers?: ProviderDTO[] };
      setProviders(json.providers ?? []);
    } catch {
      /* список не загружен - селектор останется пустым */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = providers ?? [];
  const active = list.filter((p) => p.status === "active");
  const effective = defaultProvider ?? FALLBACK_PROVIDER_ID;
  const effectiveProvider = list.find((p) => p.id === effective);
  const installTarget = list.find((p) => p.id === installId);

  const options = [
    ...active.map((p) => ({
      value: p.id,
      label: `${p.label}${p.id === FALLBACK_PROVIDER_ID ? " (по умолчанию)" : ""}`,
      group: "Активные",
    })),
    // эффективный дефолт не активен - показываем его в списке с пометкой
    ...(!active.some((p) => p.id === effective) && effectiveProvider
      ? [{ value: effectiveProvider.id, label: `${effectiveProvider.label} (не активен)`, group: "Активные" }]
      : []),
  ];

  const changeDefault = async (value: string) => {
    setError(null);
    // выбор Ollama = сброс на значение по умолчанию (null)
    const ok = await setDefaultProvider(value === FALLBACK_PROVIDER_ID ? null : value);
    if (!ok) setError("не удалось сохранить - провайдер должен быть активен (проверка пройдена)");
  };

  const installOptions = [
    ...list
      .filter((p) => p.kind === "local")
      .map((p) => ({ value: p.id, label: p.label, group: "Локальные" })),
    ...list
      .filter((p) => p.kind === "online")
      .map((p) => ({ value: p.id, label: p.label, group: "Онлайн" })),
  ];

  return (
    <Panel as="article" title="AI SDK">
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Провайдер AI SDK по умолчанию для вкладки "Агент" (стриминговый диалог). Без выбора действует{" "}
        {FALLBACK_PROVIDER_ID}. Проверенные провайдеры помечаются звездой ★ также на вкладке "Провайдеры"; рантаймы
        выбираются прямо во вкладке "Агент".
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {providers ? (
          <Select
            value={effective}
            onChange={(value) => void changeDefault(value)}
            size="md"
            className="w-full max-w-sm"
            ariaLabel="провайдер AI SDK по умолчанию"
            options={options}
          />
        ) : (
          <p className="text-xs text-fg-faint">загрузка провайдеров…</p>
        )}
        <Button variant="ghostDim" size="sm" onClick={() => setInstallOpen(true)}>
          Установить провайдера
        </Button>
      </div>
      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
      {effectiveProvider && effectiveProvider.status !== "active" ? (
        <p className="mt-2 text-[11px] text-warning">
          провайдер {effectiveProvider.label} не активен - заполните поля и пройдите проверку на{" "}
          <Link href="/" className="underline decoration-dotted hover:text-fg-muted">
            вкладке "Провайдеры"
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="agent-history-limit" className="text-[11px] text-fg-faint">
          Сообщений в истории диалога
        </label>
        <Input
          id="agent-history-limit"
          type="number"
          min={0}
          max={500}
          step={1}
          value={historyDraft}
          placeholder="20"
          size="compact"
          className="w-24"
          aria-label="лимит реплик истории direct-чата"
          onChange={(event) => setHistoryDraft(event.target.value)}
          onBlur={() => void saveHistoryLimit()}
        />
        <span className="text-[11px] text-fg-faint">последние реплики direct-чата, отправляемые модели; 0 - все, пусто - 20</span>
      </div>
      {historyError ? <p className="mt-1 text-[11px] text-danger">{historyError}</p> : null}

      <Modal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        title="Установка провайдера AI SDK"
        description={`Выберите пресет, заполните ключ и base URL, нажмите "Проверить" - успешная проверка делает провайдера активным.`}
        width="max-w-2xl"
        scroll={false}
      >
        <div className="space-y-4">
          <Select
            value={installId}
            onChange={setInstallId}
            size="md"
            className="w-full"
            ariaLabel="пресет провайдера для установки"
            options={[{ value: "", label: "Выберите пресет…", group: undefined }, ...installOptions]}
          />
          {installTarget ? (
            <ProviderCard
              provider={installTarget}
              nowMs={Date.now()}
              onUpdate={(next) => setProviders((prev) => (prev ? prev.map((p) => (p.id === next.id ? next : p)) : prev))}
            />
          ) : (
            <p className="text-xs text-fg-faint">Карточка пресета появится здесь: ключ, base URL, модели по tiers и проверка соединения.</p>
          )}
        </div>
      </Modal>
    </Panel>
  );
}
