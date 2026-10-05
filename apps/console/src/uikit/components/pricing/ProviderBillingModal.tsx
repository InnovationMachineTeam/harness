"use client";

import type { ModelPriceEntry, VendorBilling } from "@/core/pricingCatalog";
import { modelEntry } from "@/core/pricingCatalog";
import type { BillingDeposit, BillingSelection } from "@/core/state";
import { Footnote, Modal, Panel } from "@/uikit";
import { PaygDeposits } from "./PaygDeposits";
import { SubscriptionPicker } from "./SubscriptionPicker";

/**
 * Окно подписки провайдера (открывается кнопкой-иконкой на карточке):
 * radio-выбор тарифа (где он есть) или Pay as You Go с пополнениями +
 * справочные цены моделей провайдера из каталога.
 */

const fmt = (value: number): string => (Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(3));

export function ProviderBillingModal({
  open,
  onClose,
  providerId,
  providerLabel,
  vendor,
  selection,
  deposits,
  models,
  catalogModels,
  spent,
  onSaveSelection,
  onSaveDeposits,
}: {
  open: boolean;
  onClose: () => void;
  providerId: string;
  providerLabel: string;
  vendor: VendorBilling | undefined;
  selection: BillingSelection;
  deposits: BillingDeposit[];
  /** Модели провайдера по tiers (id из пресета/записи). */
  models: { tier: string; model: string }[];
  catalogModels: Record<string, ModelPriceEntry>;
  spent: number | null;
  onSaveSelection: (next: BillingSelection) => void;
  onSaveDeposits: (next: BillingDeposit[]) => void;
}) {
  const depositKey = `provider:${providerId}`;
  const pricedModels = models.filter((m) => modelEntry(catalogModels, m.model));
  return (
    <Modal open={open} onClose={onClose} title={`Подписка - ${providerLabel}`} description="Тарифы и Pay as You Go из каталога .agents/pricing/." width="max-w-3xl">
      <div className="space-y-4">
        <Panel title="Способ оплаты">
          {vendor && (vendor.plans.length > 0 || vendor.payg.available) ? (
            <>
              <SubscriptionPicker name={`billing-provider-${providerId}`} plans={vendor.plans} payg={vendor.payg} selected={selection} onChange={onSaveSelection} />
              {selection.mode === "payg" ? (
                <div className="mt-3 border-t border-line/60 pt-3">
                  <Footnote className="mb-2">Расход - оценка стоимости usage в USD по данным статистики.</Footnote>
                  <PaygDeposits
                    deposits={deposits}
                    spent={spent}
                    onAdd={(deposit) => onSaveDeposits([...deposits, { ...deposit, id: `dep-${Date.now().toString(36)}` }])}
                    onRemove={(id) => onSaveDeposits(deposits.filter((d) => d.id !== id))}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <Footnote>У провайдера нет подписок и Pay as You Go в каталоге.</Footnote>
          )}
        </Panel>
        <Panel title="Стоимость API (справочно)">
          {pricedModels.length === 0 ? (
            <Footnote>Цены моделей провайдера отсутствуют в каталоге.</Footnote>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="border-b border-line p-2 text-fg-muted">Модель</th>
                  <th className="border-b border-line p-2 text-fg-muted">Официальная</th>
                  <th className="border-b border-line p-2 text-fg-muted">Средняя</th>
                </tr>
              </thead>
              <tbody>
                {pricedModels.map((model) => {
                  const entry = modelEntry(catalogModels, model.model)!;
                  const official = entry.prices.find((p) => p.official);
                  return (
                    <tr key={`${model.tier}-${model.model}`}>
                      <td className="border-b border-line/50 p-2 font-mono text-[11px]">
                        {model.model} <span className="text-fg-faint">{model.tier}</span>
                      </td>
                      <td className="border-b border-line/50 p-2 font-mono text-[11px]">
                        {official ? `${fmt(official.inputPerMtok)} / ${fmt(official.outputPerMtok)}` : <span className="text-fg-faint">нет данных</span>}
                      </td>
                      <td className="border-b border-line/50 p-2 font-mono text-[11px]">
                        {entry.average ? `${fmt(entry.average.inputPerMtok)} / ${fmt(entry.average.outputPerMtok)}` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </Modal>
  );
}
