"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderDTO } from "@/core/providers";
import type { PricingCatalogDTO } from "@/core/pricingCatalog";
import type { BillingDeposit, BillingSelection } from "@/core/state";
import { formatTokens } from "@/lib/format";
import { EmptyState, Loading, Segmented } from "@/uikit";
import { ProviderCard, type ProviderBillingProps, type ProviderUsageChip } from "./ProviderCard";

interface ProvidersData {
  providers: ProviderDTO[];
}

interface UsageData {
  totals: Record<string, { calls: number; totalTokens: number }>;
  days: Record<string, Record<string, number>>;
}

/** Сумма токенов провайдера за последние 30 дней из дневных счётчиков. */
function tokens30d(days: UsageData["days"], providerId: string, now: Date): number {
  const limit = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  let sum = 0;
  for (const [day, providers] of Object.entries(days)) {
    if (day >= limit) sum += providers[providerId] ?? 0;
  }
  return sum;
}

/** Категории фильтра провайдеров; категории по состоянию локального сервиса не пересекаются. */
type ProviderFilter = "all" | "not-installed" | "installed" | "not-running" | "active";

const FILTERS: readonly { key: ProviderFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "not-installed", label: "Не установлены" },
  { key: "installed", label: "Установлены" },
  { key: "not-running", label: "Не запущены" },
  { key: "active", label: "Активны" },
];

/** Фильтр по типу провайдера (cloud/local); накладывается на фильтр состояния. */
type ProviderKindFilter = "all" | "online" | "local";

const KIND_FILTERS: readonly { key: ProviderKindFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "online", label: "Cloud" },
  { key: "local", label: "Local" },
];

function matchesFilter(p: ProviderDTO, filter: ProviderFilter): boolean {
  switch (filter) {
    case "not-installed":
      return p.status === "not-installed";
    case "not-running":
      return p.status === "not-running";
    case "active":
      return p.status === "active";
    case "installed":
      // локальный сервис найден на машине (запущен он или нет - неважно)
      return p.kind === "local" && p.local?.installed === true;
    default:
      return true;
  }
}

function matchesKind(p: ProviderDTO, filter: ProviderKindFilter): boolean {
  return filter === "all" || p.kind === filter;
}

/**
 * Внутренняя вкладка "Провайдеры" (страница "Рантаймы"): сетка карточек
 * пресетов LLM-провайдеров с фильтром по состоянию. Данные - GET /api/providers;
 * обновление одной карточки приходит в ответе её действия.
 */
export function ProvidersPanel({ onCounts }: { onCounts?: (active: number, total: number) => void }) {
  const [data, setData] = useState<ProvidersData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [catalog, setCatalog] = useState<PricingCatalogDTO | null>(null);
  const [billingRuntimes, setBillingRuntimes] = useState<Record<string, BillingSelection>>({});
  const [billingProviders, setBillingProviders] = useState<Record<string, BillingSelection>>({});
  const [deposits, setDeposits] = useState<Record<string, BillingDeposit[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [kindFilter, setKindFilter] = useState<ProviderKindFilter>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) {
        setError("не удалось загрузить провайдеров");
        return;
      }
      setData((await res.json()) as ProvidersData);
      setError(null);
    } catch {
      setError("сеть недоступна - список провайдеров не загружен");
    }
  }, []);

  // статистика токенов: сбор внешних источников выполняет сам маршрут (TTL 5 мин)
  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/usage", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as UsageData;
      setUsage({ totals: json.totals ?? {}, days: json.days ?? {} });
    } catch {
      /* статистика не критична для панели - молча пропускаем */
    }
  }, []);

  // каталог цен и выбор подписок: грузятся один раз, экономия - общий TTL-кеш вкладок
  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch("/api/pricing", { cache: "no-store" });
      if (res.ok) setCatalog((await res.json()) as PricingCatalogDTO);
    } catch {
      /* каталог не критичен для панели */
    }
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const json = (await res.json()) as { billing?: { runtimes?: Record<string, BillingSelection>; providers?: Record<string, BillingSelection>; deposits?: Record<string, BillingDeposit[]> } };
      setBillingRuntimes(json.billing?.runtimes ?? {});
      setBillingProviders(json.billing?.providers ?? {});
      setDeposits(json.billing?.deposits ?? {});
    } catch {
      /* выбор оплаты не критичен для панели */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadUsage();
    void loadBilling();
  }, [load, loadUsage, loadBilling]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!data) return;
    const active = data.providers.filter((p) => p.status === "active").length;
    onCounts?.(active, data.providers.length);
  }, [data, onCounts]);

  const onUpdate = useCallback((next: ProviderDTO) => {
    setData((prev) =>
      prev ? { providers: prev.providers.map((p) => (p.id === next.id ? next : p)) } : prev,
    );
  }, []);

  const saveProviderSelection = useCallback(async (providerId: string, next: BillingSelection) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billing: { providers: { [providerId]: next } } }),
    });
    if (res.ok) setBillingProviders((prev) => ({ ...prev, [providerId]: next }));
  }, []);

  const saveProviderDeposits = useCallback(async (providerId: string, next: BillingDeposit[]) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billing: { deposits: { [`provider:${providerId}`]: next } } }),
    });
    if (res.ok) setDeposits((prev) => ({ ...prev, [`provider:${providerId}`]: next }));
  }, []);

  const providerBilling = useCallback(
    (providerId: string): ProviderBillingProps | undefined => {
      if (!catalog) return undefined;
      return {
        vendor: catalog.subscriptions.providers[providerId],
        selection: billingProviders[providerId] ?? { mode: "none" },
        deposits: deposits[`provider:${providerId}`] ?? [],
        spent: null,
        catalogModels: catalog.models.models,
        onSaveSelection: (next) => void saveProviderSelection(providerId, next),
        onSaveDeposits: (next) => void saveProviderDeposits(providerId, next),
      };
    },
    [catalog, billingProviders, deposits, saveProviderSelection, saveProviderDeposits],
  );

  // сводка по провайдеру для карточки: токены за 30 дней + вызовы всего
  const usageByProvider = useMemo(() => {
    if (!usage) return null;
    const now = new Date(nowMs);
    const chips: Record<string, ProviderUsageChip> = {};
    for (const [providerId, totals] of Object.entries(usage.totals)) {
      chips[providerId] = { tokens30d: tokens30d(usage.days, providerId, now), calls: totals.calls };
    }
    return chips;
  }, [usage, nowMs]);

  const usageTotals = useMemo(() => {
    if (!usageByProvider) return null;
    let tokens = 0;
    let calls = 0;
    for (const chip of Object.values(usageByProvider)) {
      tokens += chip.tokens30d;
      calls += chip.calls;
    }
    return { tokens, calls };
  }, [usageByProvider]);

  // фильтры накладываются; счётчики каждого фильтра учитывают выбранное значение другого
  const filtered = useMemo(
    () => (data ? data.providers.filter((p) => matchesKind(p, kindFilter) && matchesFilter(p, filter)) : []),
    [data, filter, kindFilter],
  );

  const statusCounts = useMemo(() => {
    if (!data) return null;
    const inKind = data.providers.filter((p) => matchesKind(p, kindFilter));
    const counts: Record<ProviderFilter, number> = { all: inKind.length, "not-installed": 0, installed: 0, "not-running": 0, active: 0 };
    for (const p of inKind) {
      for (const f of FILTERS) {
        if (f.key !== "all" && matchesFilter(p, f.key)) counts[f.key] += 1;
      }
    }
    return counts;
  }, [data, kindFilter]);

  const kindCounts = useMemo(() => {
    if (!data) return null;
    const inStatus = data.providers.filter((p) => matchesFilter(p, filter));
    const counts: Record<ProviderKindFilter, number> = { all: inStatus.length, online: 0, local: 0 };
    for (const p of inStatus) {
      if (matchesKind(p, "online")) counts.online += 1;
      if (matchesKind(p, "local")) counts.local += 1;
    }
    return counts;
  }, [data, filter]);

  if (error) {
    return <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-danger">{error}</p>;
  }
  if (!data) {
    return <Loading>загрузка провайдеров…</Loading>;
  }

  const active = data.providers.filter((p) => p.status === "active").length;
  const filled = data.providers.filter((p) => p.status === "filled" || p.status === "error").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="text-accent">{active} активны</span>
          <span className="text-warning">{filled} заполнены без проверки</span>
          <span className="text-fg-faint">{data.providers.length - active - filled} не заполнены</span>
          {usageTotals && usageTotals.calls > 0 ? (
            <span className="text-fg-faint">токены за 30 дней: {formatTokens(usageTotals.tokens)} · вызовов всего: {usageTotals.calls}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented
            options={FILTERS.map((f) => ({
              key: f.key,
              label: statusCounts ? `${f.label} · ${statusCounts[f.key]}` : f.label,
            }))}
            value={filter}
            onChange={setFilter}
            ariaLabel="Фильтр провайдеров по состоянию"
          />
          <Segmented
            options={KIND_FILTERS.map((f) => ({
              key: f.key,
              label: kindCounts ? `${f.label} · ${kindCounts[f.key]}` : f.label,
            }))}
            value={kindFilter}
            onChange={setKindFilter}
            ariaLabel="Фильтр провайдеров по типу (cloud/local)"
          />
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProviderCard key={p.id} provider={p} nowMs={nowMs} usage={usageByProvider?.[p.id]} billing={providerBilling(p.id)} onUpdate={onUpdate} />
          ))}
        </div>
      ) : (
        <EmptyState>В категории нет провайдеров.</EmptyState>
      )}

      <footer className="mt-10 border-t border-line/60 pt-4 text-[11px] leading-relaxed text-fg-faint">
        Провайдер активен, когда заполнен ключ и пройдена проверка соединения; провайдер без ключа - неактивен.
        Активные провайдеры доступны
        в задачах "Исполнение команд" и "Создание навыка" (Настройки - Основные), в LLM-настройках OpenWiki и
        Graphify; кнопка "Экспорт для LangGraph" записывает ключ, base URL и модели в
        <span className="font-mono"> .agents/console/langgraph.env</span>. Настройки хранятся в
        <span className="font-mono"> .agents/providers/&lt;id&gt;/</span>: settings.json - в git, ключ (key.env) и
        сертификат (ca.pem) - вне git. Статистика токенов (вызовы консоли, сессии рантаймов, счётчики
        graphify/headroom) - <span className="font-mono"> /api/providers/usage</span> и файл
        <span className="font-mono"> .agents/console/provider-usage.json</span>.
      </footer>
    </>
  );
}
