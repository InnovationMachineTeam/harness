"use client";

import { PLAN_PERIOD_LABEL, PLAN_PERIOD_MONTHS, type SubscriptionPlan } from "@/core/pricingCatalog";
import type { BillingMode, BillingSelection } from "@/core/state";
import { Chip, RadioRow } from "@/uikit";

/**
 * Radio-выбор способа оплаты: «Нет подписки» (по умолчанию), тарифы каталога
 * .agents/pricing/subscriptions.json и Pay as You Go. Один элемент группы на
 * value; Pay as You Go - отдельная опция рядом с тарифами.
 */

function perMonth(plan: SubscriptionPlan): string {
  const months = PLAN_PERIOD_MONTHS[plan.period];
  if (months <= 1) return "";
  const monthly = Math.round((plan.price / months) * 100) / 100;
  return `≈ ${monthly} ${plan.currency}/мес`;
}

export function SubscriptionPicker({
  name,
  plans,
  payg,
  selected,
  onChange,
  disabled,
}: {
  name: string;
  plans: SubscriptionPlan[];
  payg?: { available: boolean; note?: string };
  selected: BillingSelection;
  onChange: (next: BillingSelection) => void;
  disabled?: boolean;
}) {
  const mode: BillingMode = selected.mode;
  return (
    <div className="space-y-1">
      <RadioRow
        name={name}
        checked={mode === "none"}
        onChange={() => onChange({ mode: "none" })}
        title="Нет подписки"
        description="оплата не отслеживается"
        disabled={disabled}
      />
      {plans.map((plan) => (
        <RadioRow
          key={plan.id}
          name={name}
          checked={mode === "plan" && selected.planId === plan.id}
          onChange={() => onChange({ mode: "plan", planId: plan.id })}
          title={plan.name}
          description={[PLAN_PERIOD_LABEL[plan.period], perMonth(plan)].filter(Boolean).join(" · ")}
          trailing={
            <Chip tone={mode === "plan" && selected.planId === plan.id ? "sky" : "muted"} mono>
              {plan.price} {plan.currency}
            </Chip>
          }
          disabled={disabled}
        />
      ))}
      <RadioRow
        name={name}
        checked={mode === "payg"}
        onChange={() => onChange({ mode: "payg" })}
        title="Pay as You Go"
        description={payg?.note ?? "оплата по факту: пополнения и расход"}
        disabled={disabled || (payg ? !payg.available : false)}
      />
    </div>
  );
}
