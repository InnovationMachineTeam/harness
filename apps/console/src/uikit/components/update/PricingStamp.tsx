"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PricingCatalogDTO } from "@/core/pricingCatalog";
import { useConsoleStore } from "@/store/console";
import { Button, Chip, confirmDialog, Notice } from "@/uikit";

/**
 * Строка цен каталога на вкладке «Обновить»: дата последнего обновления
 * подписок и моделей, статусы зафиксированных источников и кнопка обновления
 * с подтверждением (POST /api/pricing/refresh).
 */

interface RefreshResult {
  checked: number;
  ok: number;
  unavailable: { id: string; error: string }[];
  modelsUpdated: boolean;
  checkedAt: string;
}

function formatStamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PricingStamp() {
  const [catalog, setCatalog] = useState<PricingCatalogDTO | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pricing", { cache: "no-store" });
      setCatalog((await res.json()) as PricingCatalogDTO);
    } catch {
      setError("каталог цен не загружен");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updatedAt = [catalog?.subscriptions.updatedAt, catalog?.models.updatedAt]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const sources = catalog?.sources ?? [];
  const unavailable = sources.filter((s) => s.status === "unavailable");

  const refresh = async () => {
    const ok = await confirmDialog({
      title: "Обновить цены подписок и моделей?",
      message: "Консоль опросит зафиксированные источники (.agents/pricing/sources.json). Недоступный источник не останавливает остальные; значения остаются прежними.",
      confirmLabel: "Обновить",
    });
    if (!ok) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing/refresh", { method: "POST" });
      const json = (await res.json()) as RefreshResult & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "обновление не выполнено");
        return;
      }
      setResult(json);
      await load();
      useConsoleStore.getState().invalidateTab("pricing");
    } catch {
      setError("сеть недоступна - обновление не выполнено");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Цены подписок и моделей</span>
        {unavailable.length > 0 ? <Chip tone="amber">источников недоступно: {unavailable.length}</Chip> : null}
        <span className="ml-auto" />
        <Button variant="primary" size="xs" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} aria-hidden />
          {refreshing ? "Обновление…" : "Обновить цены"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">
        Последнее обновление: {formatStamp(updatedAt)} · источников: {sources.length}
        {sources.length > 0 ? ` · отвечают: ${sources.length - unavailable.length}` : ""}
      </p>
      {unavailable.length > 0 ? (
        <p className="mt-1 text-[11px] text-warning" title={unavailable.map((s) => `${s.id}: ${s.lastError ?? ""}`).join("; ")}>
          Недоступные: {unavailable.map((s) => s.id).join(", ")} - данные остаются прежними.
        </p>
      ) : null}
      {result ? (
        <Notice tone={result.unavailable.length > 0 ? "info" : "success"} className="mt-2">
          Проверено источников: {result.checked}, отвечают: {result.ok}
          {result.modelsUpdated ? ", цены моделей обновлены (OpenRouter)" : ""}
          {result.unavailable.length > 0 ? `, недоступны: ${result.unavailable.map((s) => s.id).join(", ")}` : ""}.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
