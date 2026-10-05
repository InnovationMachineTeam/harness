"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelPriceEntry, PricingCatalogDTO, VendorBilling } from "@/core/pricingCatalog";
import { modelEntry, PLAN_PERIOD_LABEL } from "@/core/pricingCatalog";
import type { BillingDeposit, BillingSelection } from "@/core/state";
import { useConsoleStore } from "@/store/console";
import { Button, Chip, Footnote, Loading, Notice, Panel, SectionLabel } from "@/uikit";
import { PaygDeposits } from "@/uikit/components/pricing/PaygDeposits";
import { SubscriptionPicker } from "@/uikit/components/pricing/SubscriptionPicker";

/**
 * Вкладка «Подписки» рантайма: radio-выбор (нет подписки по умолчанию /
 * тариф каталога / Pay as You Go с пополнениями) и справочные API-цены
 * моделей из каталога .agents/pricing/.
 */

interface RuntimeModelRef {
  tier: string;
  model: string;
}

interface StatsTotals {
  totals?: { costUsd?: number | null };
}

const fmt = (value: number): string => {
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 1 ? value.toFixed(2) : value.toFixed(3);
};

/** Строка справочной таблицы: модель + официальная цена, средняя, список провайдеров. */
function ModelPriceRow({ model, entry }: { model: RuntimeModelRef; entry: ModelPriceEntry | undefined }) {
  const official = entry?.prices.find((p) => p.official);
  const average = entry?.average ?? null;
  const providers = entry?.prices.map((p) => p.provider).join(", ");
  return (
    <tr>
      <td className="border-b border-line/50 p-2 align-top">
        <span className="font-mono text-[11px]">{model.model}</span>
        <span className="ml-1.5 text-[10px] text-fg-faint">{model.tier}</span>
      </td>
      <td className="border-b border-line/50 p-2 align-top font-mono text-[11px]">
        {official ? `${fmt(official.inputPerMtok)} / ${fmt(official.outputPerMtok)}` : <span className="text-fg-faint">нет данных</span>}
      </td>
      <td className="border-b border-line/50 p-2 align-top font-mono text-[11px]">
        {average ? `${fmt(average.inputPerMtok)} / ${fmt(average.outputPerMtok)}` : <span className="text-fg-faint">-</span>}
      </td>
      <td className="border-b border-line/50 p-2 align-top">
        {providers ? <Chip tone="muted" title={providers}>{entry?.prices.length ?? 0}</Chip> : <span className="text-fg-faint">-</span>}
      </td>
    </tr>
  );
}

export function BillingPanel({ runtime, models }: { runtime: string; models: RuntimeModelRef[] }) {
  const fetchTabData = useConsoleStore((s) => s.fetchTabData);
  const [catalog, setCatalog] = useState<PricingCatalogDTO | null>(null);
  const [billing, setBilling] = useState<Record<string, BillingSelection>>({});
  const [deposits, setDeposits] = useState<Record<string, BillingDeposit[]>>({});
  const [spent, setSpent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const depositKey = `runtime:${runtime}`;
  const vendor: VendorBilling | undefined = catalog?.subscriptions.vendors[runtime];
  const selection: BillingSelection = billing[runtime] ?? { mode: "none" };

  const load = useCallback(async () => {
    const cat = await fetchTabData<PricingCatalogDTO>("pricing", "/api/pricing", 60_000);
    setCatalog(cat ?? null);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const json = (await res.json()) as { billing?: { runtimes?: Record<string, BillingSelection>; deposits?: Record<string, BillingDeposit[]> } };
      setBilling(json.billing?.runtimes ?? {});
      setDeposits(json.billing?.deposits ?? {});
    } catch {
      setError("настройки оплаты не загружены");
    }
    try {
      const res = await fetch(`/api/stats?period=all&runtime=${encodeURIComponent(runtime)}`, { cache: "no-store" });
      const json = (await res.json()) as StatsTotals;
      setSpent(typeof json.totals?.costUsd === "number" ? json.totals.costUsd : null);
    } catch {
      setSpent(null);
    }
  }, [fetchTabData, runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSelection = async (next: BillingSelection) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billing: { runtimes: { [runtime]: next } } }),
      });
      if (!res.ok) {
        setError("выбор не сохранён");
        return;
      }
      setBilling((prev) => ({ ...prev, [runtime]: next }));
    } finally {
      setSaving(false);
    }
  };

  const saveDeposits = async (next: BillingDeposit[]) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billing: { deposits: { [depositKey]: next } } }),
    });
    if (res.ok) setDeposits((prev) => ({ ...prev, [depositKey]: next }));
  };

  const planById = (planId: string | undefined) => vendor?.plans.find((p) => p.id === planId);

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!catalog ? (
          <Loading>Каталог цен…</Loading>
      ) : (
        <>
          <Panel title="Способ оплаты">
            {!vendor ? (
              <Notice tone="info">Для рантайма «{runtime}» нет тарифов в каталоге подписок. Доступен только Pay as You Go.</Notice>
            ) : (
              <Footnote className="mb-2">
                Тарифы вендора {vendor.label} из каталога .agents/pricing/subscriptions.json; источник обновляется на вкладке «Обновить».
              </Footnote>
            )}
            <SubscriptionPicker
              name={`billing-${runtime}`}
              plans={vendor?.plans ?? []}
              payg={vendor?.payg}
              selected={selection}
              onChange={(next) => void saveSelection(next)}
              disabled={saving}
            />
            {selection.mode === "plan" && planById(selection.planId) ? (
              <p className="mt-2 text-xs text-fg-muted">
                Выбран тариф «{planById(selection.planId)?.name}»: {planById(selection.planId)?.price} {planById(selection.planId)?.currency} за{" "}
                {PLAN_PERIOD_LABEL[planById(selection.planId)?.period ?? "month"]}.
              </p>
            ) : null}
          </Panel>

          {selection.mode === "payg" ? (
            <Panel title="Pay as You Go - пополнения">
              <Footnote className="mb-2">
                Зачисления хранятся локально и служат для мониторинга остатка. Расход - оценка стоимости usage в USD по данным статистики.
              </Footnote>
              <PaygDeposits
                deposits={deposits[depositKey] ?? []}
                spent={spent}
                onAdd={(deposit) => saveDeposits([...(deposits[depositKey] ?? []), { ...deposit, id: `dep-${Date.now().toString(36)}` }])}
                onRemove={(id) => saveDeposits((deposits[depositKey] ?? []).filter((d) => d.id !== id))}
              />
            </Panel>
          ) : null}

          <Panel title="Стоимость API (справочно)">
            <Footnote className="mb-2">
              Цены за миллион токенов (вход / выход) из каталога моделей. Официальная цена приоритетна при расчётах; при её отсутствии используется средняя
              по провайдерам (колонка «Провайдеры» - число источников цены). Справочная информация: на подписку не влияет.
            </Footnote>
            {models.filter((m) => m.model.trim()).length === 0 ? (
              <p className="text-xs text-fg-faint">Модели рантайма неизвестны.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="border-b border-line p-2 text-fg-muted">Модель</th>
                      <th className="border-b border-line p-2 text-fg-muted">Официальная</th>
                      <th className="border-b border-line p-2 text-fg-muted">Средняя</th>
                      <th className="border-b border-line p-2 text-fg-muted">Провайдеры</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.filter((m) => m.model.trim()).map((model) => (
                      <ModelPriceRow key={`${model.tier}-${model.model}`} model={model} entry={modelEntry(catalog.models.models, model.model)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <SectionLabel>Каталог обновлён: {catalog.models.updatedAt ? new Date(catalog.models.updatedAt).toLocaleString() : "-"}</SectionLabel>
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="ghostDim"
              onClick={() => {
                useConsoleStore.getState().invalidateTab("pricing");
                void load();
              }}
            >
              Обновить данные
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
