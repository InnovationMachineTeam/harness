"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BillingDeposit } from "@/core/state";
import { Button, Chip, EmptyState, Input, Modal } from "@/uikit";

/**
 * Пополнения Pay as You Go: список зачислений, добавление (модалка: сумма,
 * дата, заметка) и удаление; сводка - пополнено и остаток (остаток требует
 * переданного spent - расхода по данным usage).
 */

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function PaygDeposits({
  deposits,
  spent,
  onAdd,
  onRemove,
}: {
  deposits: BillingDeposit[];
  /** Расход по данным usage (та же валюта, что у пополнений первой записи); null - расход неизвестен. */
  spent: number | null;
  onAdd: (deposit: Omit<BillingDeposit, "id">) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const total = deposits.reduce((sum, d) => sum + d.amount, 0);
  const currency = deposits[0]?.currency ?? "USD";

  const submit = async () => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    try {
      await onAdd({ amount: value, currency, at: new Date(`${date}T12:00:00.000Z`).toISOString(), note: note.trim() || undefined });
      setAmount("");
      setNote("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Chip tone="sky" mono>пополнено: {total.toFixed(2)} {currency}</Chip>
        {spent !== null ? (
          <Chip tone={total - spent < 0 ? "red" : "emerald"} mono>
            остаток: {(total - spent).toFixed(2)} {currency}
          </Chip>
        ) : (
          <Chip tone="dim" mono>расход неизвестен</Chip>
        )}
        <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
          <Plus size={13} aria-hidden className="mr-1 inline" /> Пополнение
        </Button>
      </div>
      {deposits.length === 0 ? (
        <EmptyState size="sm">Пополнений нет - добавьте зачисление, чтобы следить за остатком Pay as You Go.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          {deposits.map((deposit) => (
            <div key={deposit.id} className="flex items-center gap-2 border-b border-line/50 px-3 py-1.5 text-xs last:border-b-0">
              <span className="font-mono text-fg">{deposit.amount.toFixed(2)} {deposit.currency}</span>
              <span className="text-fg-faint">{formatDate(deposit.at)}</span>
              {deposit.note ? <span className="truncate text-fg-muted" title={deposit.note}>{deposit.note}</span> : null}
              <button
                type="button"
                onClick={() => void onRemove(deposit.id)}
                title="Удалить пополнение"
                aria-label="Удалить пополнение"
                className="ml-auto text-fg-faint transition-colors hover:text-danger"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Пополнение Pay as You Go"
        description="Зачисление средств для мониторинга остатка."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button variant="primary" disabled={busy || !amount.trim()} onClick={() => void submit()}>Добавить</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-fg-muted">Сумма ({currency})</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20" inputMode="decimal" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-fg-muted">Дата</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-fg-muted">Заметка</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
          </label>
        </div>
      </Modal>
    </div>
  );
}
