"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Input, Notice, Panel, Toggle } from "@/uikit";

/**
 * Панель "AG-UI endpoint" (Настройки → Основные): включение endpoint'а
 * протокола AG-UI и управление Bearer-токеном. Внешние приложения
 * (CopilotKit OpenBot/OpenDuet/OpenMuse) подключают агентов Harness как
 * bring-your-own-agent по адресу POST /api/agui с этим токеном.
 */
export function AguiEndpointPanel() {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agui/config", { cache: "no-store" });
      const json = (await res.json()) as { enabled?: boolean; token?: string };
      setEnabled(Boolean(json.enabled));
      setToken(json.token ?? "");
    } catch {
      setError("не удалось загрузить состояние endpoint");
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  const save = async (patch: { enabled?: boolean; regenerate?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agui/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const json = (await res.json()) as { enabled?: boolean; token?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setEnabled(Boolean(json.enabled));
      setToken(json.token ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      as="article"
      title="AG-UI endpoint"
      actions={enabled ? <Chip tone="emerald">включён</Chip> : <Chip tone="muted">выключен</Chip>}
    >
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Протокол AG-UI для внешних приложений (CopilotKit OpenBot, OpenDuet, OpenMuse): их бот получает агентов Harness
        (рантаймы и провайдеры) по адресу <span className="font-mono">POST /api/agui</span>. Запросы авторизуются
        Bearer-токеном; диалоги сохраняются в историю direct-чатов. Подробности - docs/agui.md.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          checked={enabled}
          onChange={(value) => void save({ enabled: value })}
          disabled={busy}
          ariaLabel="включить AG-UI endpoint"
        />
        <span className="text-xs text-fg-faint">{enabled ? "endpoint принимает запросы" : "endpoint закрыт (403)"}</span>
        <Button size="xs" disabled={busy || !token} onClick={() => void save({ regenerate: true })}>Сгенерировать токен</Button>
      </div>
      {token ? (
        <div className="mt-3 space-y-1.5">
          <Input readOnly value={`${origin}/api/agui`} className="w-full font-mono text-[11px]" aria-label="адрес endpoint" onFocus={(event) => event.target.select()} />
          <Input readOnly value={`Authorization: Bearer ${token}`} className="w-full font-mono text-[11px]" aria-label="заголовок авторизации" onFocus={(event) => event.target.select()} />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-fg-faint">Токен создаётся при первом включении.</p>
      )}
    </Panel>
  );
}
