"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/uikit";
import { ChipsField } from "@/uikit/components/workflows/editor-shared";

/** Каталог дизайн-провайдеров (тот же, что в панели "Провайдеры дизайна" раздела "Дизайн"). */
const DESIGN_PROVIDER_OPTIONS = [
  { value: "claude-design", label: "Claude Design" },
  { value: "open-design", label: "Open Design" },
  { value: "figma", label: "Figma MCP" },
];

/**
 * Вкладка "Настройки" пространства рантайма: порядок дизайн-провайдеров
 * (settings.workflows.designProviders[-runtime]). Чипы перетаскиваются
 * (порядок = приоритет в дизайн-задачах), клик убирает; изменение сохраняется сразу.
 */
export function DesignProvidersPanel({ runtime }: { runtime: string }) {
  const [map, setMap] = useState<Record<string, string[]> | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { workflowSettings?: { designProviders?: Record<string, string[]> } };
      setMap(json.workflowSettings?.designProviders ?? {});
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: string[]) => {
    if (!map) return;
    // PUT мерджит workflowSettings поверхностно: уходит полная карта, патчится только ключ рантайма
    const designProviders = { ...map, [runtime]: next };
    setMap(designProviders);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowSettings: { designProviders } }),
      });
      setMessage(res.ok ? { ok: true, text: "Сохранено" } : { ok: false, text: "Ошибка сохранения" });
    } catch {
      setMessage({ ok: false, text: "сеть недоступна - изменение не сохранено" });
    }
  };

  return (
    <Panel title="Design providers">
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Порядок применения дизайн-провайдеров в дизайн-задачах этого рантайма: чипы перетаскиваются мышью (порядок -
        приоритет), клик по чипу убирает его, добавление - списком. "claude-design" - встроенная команда /design рантайма
        Claude Code; "open-design" и "figma" - имена серверов в реестре MCP (включаются в "Настройки → MCP").
      </p>
      {!map ? (
        <p className="text-xs text-fg-muted">Загрузка...</p>
      ) : (
        <>
          <ChipsField
            label="Провайдеры дизайна"
            value={map[runtime] ?? []}
            options={DESIGN_PROVIDER_OPTIONS}
            onChange={(next) => void save(next)}
            addLabel="Добавить провайдер"
            sortable
            emptyHint="пусто - используется порядок по умолчанию: open-design, figma"
          />
          {message ? (
            <p className={`mt-2 text-[11px] ${message.ok ? "text-accent" : "text-danger"}`}>{message.text}</p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
